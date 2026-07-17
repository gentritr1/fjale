#!/usr/bin/env node

// Deterministic accepted-guess builder for FJALË.
//
// This is *Hunspell-declared form expansion*, not full Albanian morphology:
// it reads the vendored, checksum-pinned `sq_AL.dic` + `sq_AL.aff` pair and
// generates exactly the surface forms the affix file declares for each root.
// Gaps in the upstream affix tables are gaps here too; closing them requires
// additional reviewed sources (see LEXICON.md and THIRD_PARTY_NOTICES.md).
//
// Supported Hunspell .aff features (all that sq_AL.aff actually uses):
//   - Single-character ASCII flags (no FLAG directive => default flag mode).
//   - SFX rule groups: strip / add / condition, matched at the word end.
//   - PFX rule groups: strip / add / condition, matched at the word start.
//   - Cross-products between a PFX and an SFX when BOTH groups are declared
//     with the cross-product flag "Y" (every group in sq_AL.aff is "Y").
//   - Condition patterns: "." (any char), literal chars, "[...]" and "[^...]"
//     single-character classes.
// Deliberately NOT implemented, because sq_AL.aff does not declare them:
//   affix continuation classes, COMPOUND*, NEEDAFFIX/CIRCUMFIX, morphological
//   fields, two-character/numeric flags, and the suggestion-only SET/TRY/REP
//   directives (SET UTF-8 is honoured implicitly by reading files as UTF-8).
//
// Generation is byte-deterministic: same vendored inputs -> identical output
// file. There are no timestamps and no randomness. The corpus version below is
// hand-set and only changes on a deliberate corpus release.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Hand-set corpus version. Bump only on a deliberate, reviewed corpus release,
// and keep it in agreement with the service-worker cache name and LEXICON.md.
export const CORPUS_VERSION = "2-hunspell-declared-2026-07-18";

const ALBANIAN_DIGRAPHS = new Set([
  "dh",
  "gj",
  "ll",
  "nj",
  "rr",
  "sh",
  "th",
  "xh",
  "zh",
]);

const ALBANIAN_SINGLE_LETTERS = new Set([
  "a",
  "b",
  "c",
  "ç",
  "d",
  "e",
  "ë",
  "f",
  "g",
  "h",
  "i",
  "j",
  "k",
  "l",
  "m",
  "n",
  "o",
  "p",
  "q",
  "r",
  "s",
  "t",
  "u",
  "v",
  "x",
  "y",
  "z",
]);

export function tokenizeAlbanian(word) {
  const tokens = [];

  for (let index = 0; index < word.length; ) {
    const pair = word.slice(index, index + 2);

    if (ALBANIAN_DIGRAPHS.has(pair)) {
      tokens.push(pair);
      index += 2;
      continue;
    }

    const letter = word[index];
    if (!ALBANIAN_SINGLE_LETTERS.has(letter)) {
      return null;
    }

    tokens.push(letter);
    index += 1;
  }

  return tokens;
}

export function isFiveLetterLowercaseAlbanian(root) {
  if (!root || root !== root.toLocaleLowerCase("sq-AL")) {
    return false;
  }

  const tokens = tokenizeAlbanian(root);
  return tokens !== null && tokens.length === 5;
}

// Compile a Hunspell condition into a matcher. The pattern only uses ".",
// literal characters, and single-character "[...]"/"[^...]" classes, so it maps
// directly onto a JS regular expression anchored at the relevant word edge.
function compileCondition(condition, edge) {
  if (condition === "." || condition === "") {
    // "." means "any single trailing/leading char"; treat empty as always-on.
    const anchored =
      edge === "suffix" ? /.$/u : edge === "prefix" ? /^./u : /.?/u;
    return condition === "" ? { test: () => true } : anchored;
  }

  const body = condition.normalize("NFC");
  const source = edge === "suffix" ? `${body}$` : `^${body}`;
  return new RegExp(source, "u");
}

function parseAffixRule(fields, kind) {
  // SFX/PFX flag strip add condition [morph...]
  const strip = fields[2] === "0" ? "" : fields[2].normalize("NFC");
  const add = fields[3] === "0" ? "" : fields[3].normalize("NFC");
  const conditionRaw = fields[4] ?? ".";
  const edge = kind === "SFX" ? "suffix" : "prefix";
  return {
    strip,
    add,
    conditionRaw,
    condition: compileCondition(conditionRaw, edge),
  };
}

export function parseAff(affText) {
  const sfx = new Map();
  const pfx = new Map();
  let current = null;

  for (const rawLine of affText.split(/\r?\n/u)) {
    const line = rawLine.replace(/^﻿/u, "");
    if (!line.trim() || line.trimStart().startsWith("#")) {
      continue;
    }

    const fields = line.trim().split(/\s+/u);
    const kind = fields[0];
    if (kind !== "SFX" && kind !== "PFX") {
      // SET / TRY / REP and any other directive are not expansion inputs.
      current = null;
      continue;
    }

    const flag = fields[1];
    const target = kind === "SFX" ? sfx : pfx;

    if (fields[2] === "Y" || fields[2] === "N") {
      // Group header: "SFX flag crossProduct count".
      current = {
        kind,
        flag,
        crossProduct: fields[2] === "Y",
        rules: [],
      };
      target.set(flag, current);
      continue;
    }

    // Rule line for the current group.
    if (!current || current.flag !== flag || current.kind !== kind) {
      throw new Error(`Orphan ${kind} rule for flag ${flag}: ${line}`);
    }
    current.rules.push(parseAffixRule(fields, kind));
  }

  return { sfx, pfx };
}

function applySuffix(stem, rule) {
  if (!rule.condition.test(stem)) {
    return null;
  }
  if (rule.strip && !stem.endsWith(rule.strip)) {
    return null;
  }
  const base = rule.strip ? stem.slice(0, stem.length - rule.strip.length) : stem;
  return base + rule.add;
}

function applyPrefix(stem, rule) {
  if (!rule.condition.test(stem)) {
    return null;
  }
  if (rule.strip && !stem.startsWith(rule.strip)) {
    return null;
  }
  const base = rule.strip ? stem.slice(rule.strip.length) : stem;
  return rule.add + base;
}

// Expand one dictionary entry into the stem plus every Hunspell-declared form.
// Returns forms with their original case preserved; the caller applies the
// normalize/lowercase/five-token gate.
export function expandEntry(stem, flagString, aff) {
  const forms = new Set([stem]);
  if (!flagString) {
    return forms;
  }

  const flags = [...flagString];

  // Suffix-only forms. Track cross-product-eligible ones for later prefixing.
  const crossEligibleSuffixed = [];
  for (const flag of flags) {
    const group = aff.sfx.get(flag);
    if (!group) {
      continue;
    }
    for (const rule of group.rules) {
      const form = applySuffix(stem, rule);
      if (form === null) {
        continue;
      }
      forms.add(form);
      if (group.crossProduct) {
        crossEligibleSuffixed.push(form);
      }
    }
  }

  // Prefix-only forms, plus prefix x suffix cross-products (both groups Y).
  for (const flag of flags) {
    const group = aff.pfx.get(flag);
    if (!group) {
      continue;
    }
    for (const rule of group.rules) {
      const prefixedStem = applyPrefix(stem, rule);
      if (prefixedStem !== null) {
        forms.add(prefixedStem);
      }
      if (!group.crossProduct) {
        continue;
      }
      for (const suffixed of crossEligibleSuffixed) {
        const combined = applyPrefix(suffixed, rule);
        if (combined !== null) {
          forms.add(combined);
        }
      }
    }
  }

  return forms;
}

function parseDictionaryEntry(line) {
  const token = line.trim().split(/\s+/u, 1)[0];
  if (!token) {
    return null;
  }
  const slash = token.indexOf("/");
  const stem = (slash === -1 ? token : token.slice(0, slash)).normalize("NFC");
  const flags = slash === -1 ? "" : token.slice(slash + 1);
  return { stem, flags };
}

// Pure core build: given the raw vendored .dic and .aff text, return the sorted,
// deduplicated array of accepted guesses. Deterministic for fixed inputs.
export function buildAcceptedWords(dictionaryText, affText) {
  const aff = parseAff(affText);
  const lines = dictionaryText.split(/\r?\n/u);
  const declaredEntryCount = Number.parseInt(lines[0], 10);

  if (!Number.isInteger(declaredEntryCount)) {
    throw new Error("Invalid Hunspell header: missing entry count");
  }

  const accepted = new Set();
  for (let index = 1; index < lines.length; index += 1) {
    const entry = parseDictionaryEntry(lines[index]);
    if (!entry) {
      continue;
    }
    for (const form of expandEntry(entry.stem, entry.flags, aff)) {
      if (isFiveLetterLowercaseAlbanian(form)) {
        accepted.add(form);
      }
    }
  }

  return {
    words: [...accepted].sort((left, right) =>
      left.localeCompare(right, "sq-AL"),
    ),
    declaredEntryCount,
  };
}

export function renderAcceptedWordsModule(words) {
  return `// Generated by scripts/build-accepted-words.mjs. Do not edit this file by hand.
// Corpus version: ${CORPUS_VERSION}
// Source: Albanian MySpell/Hunspell dictionary v1.6.4 by Luan Kelmendi,
// distributed by LibreOffice under GPL-2.0-or-later (sq_AL.dic + sq_AL.aff).
// Hunspell-declared affix forms are expanded deterministically; this is
// declared-form expansion, not full Albanian morphology. See LEXICON.md and
// THIRD_PARTY_NOTICES.md.

export const CORPUS_VERSION = ${JSON.stringify(CORPUS_VERSION)};

export const ACCEPTED_WORDS = Object.freeze(${JSON.stringify(words)});

export const ACCEPTED_WORD_SET = new Set(ACCEPTED_WORDS);
`;
}

async function main() {
  const dictionaryPath = resolve(
    process.argv[2] ?? "third_party/sq_AL/sq_AL.dic",
  );
  const affPath = resolve(process.argv[3] ?? "third_party/sq_AL/sq_AL.aff");
  const outputPath = resolve(process.argv[4] ?? "src/accepted-words.js");

  const [dictionaryText, affText] = await Promise.all([
    readFile(dictionaryPath, "utf8"),
    readFile(affPath, "utf8"),
  ]);

  const started = process.hrtime.bigint();
  const { words, declaredEntryCount } = buildAcceptedWords(
    dictionaryText,
    affText,
  );
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, renderAcceptedWordsModule(words), "utf8");

  console.log(
    `Generated ${words.length.toLocaleString("en-US")} accepted Albanian words ` +
      `from ${declaredEntryCount.toLocaleString("en-US")} Hunspell entries ` +
      `(corpus ${CORPUS_VERSION}) in ${elapsedMs.toFixed(0)} ms.`,
  );
  console.log(`Wrote ${outputPath}`);
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath || fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
