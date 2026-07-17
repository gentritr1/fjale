import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { ALBANIAN_ALPHABET, ALBANIAN_DIGRAPHS, tokenizeAlbanian } from "../src/game.js";
import { ACCEPTED_GUESSES, ANSWERS } from "../src/words.js";
import { ACCEPTED_WORD_SET, CORPUS_VERSION } from "../src/accepted-words.js";
import {
  buildAcceptedWords,
  renderAcceptedWordsModule,
} from "../scripts/build-accepted-words.mjs";

const DAILY_V1_CATALOG_SHA256 =
  "9a347248a5e4e43fdecae1c9c6afc503fb36054d055651eb398e932af0ff25dd";
const LEGACY_CHALLENGE_CATALOG_SHA256 =
  "67edd1a27dd062dc2742236d21b7098f2d187abb51d919fe417ca5f73b7877b6";
const DICTIONARY_SHA256 =
  "8fba63fcf7320910803739cc2f0475224a7e8f38f696963d0968e6122a7c0343";
const AFFIX_SHA256 =
  "d20b6a23431d28fe6d4e6327eedf846dbed1c3ffbb9574fdcfed4ec308422010";

// The accepted-guess corpus size changes ONLY on a deliberate, reviewed corpus
// release. corpus 2-hunspell-declared: 14,255 original five-token roots plus
// Hunspell-declared affix forms that tokenize to exactly five Albanian letters.
const EXPECTED_CORPUS_SIZE = 21_481;

test("keeps the published 62-word daily v1 catalog stable", () => {
  const words = ANSWERS.map((answer) => answer.word);
  const publishedWords = words.slice(0, 62);
  const digest = createHash("sha256").update(publishedWords.join("\n")).digest("hex");

  assert.ok(words.length >= 62);
  assert.equal(new Set(words).size, words.length);
  assert.equal(digest, DAILY_V1_CATALOG_SHA256);
});

test("keeps every legacy challenge index mapped to its original answer", () => {
  const words = ANSWERS.map((answer) => answer.word);
  const digest = createHash("sha256").update(words.join("\n")).digest("hex");

  assert.equal(words.length, 138);
  assert.equal(digest, LEGACY_CHALLENGE_CATALOG_SHA256);
});

test("validates every answer with the production Albanian tokenizer", () => {
  const coveredLetters = new Set();
  const coveredDigraphs = new Set();

  for (const answer of ANSWERS) {
    const tokens = tokenizeAlbanian(answer.word);
    assert.equal(tokens.length, 5, `${answer.word} must contain five Albanian letters`);
    assert.equal(answer.word, answer.word.normalize("NFC").toLocaleLowerCase("sq-AL"));
    assert.equal(answer.region, "standard");

    for (const field of ["partOfSpeech", "syllables", "clue", "definition", "example"]) {
      assert.ok(answer[field]?.trim(), `${answer.word} is missing ${field}`);
    }

    for (const token of tokens) {
      coveredLetters.add(token);
      if (ALBANIAN_DIGRAPHS.includes(token)) {
        coveredDigraphs.add(token);
      }
    }

    assert.ok(ACCEPTED_GUESSES.has(answer.word), `${answer.word} must be accepted as a guess`);
  }

  assert.deepEqual([...coveredLetters].sort(), [...ALBANIAN_ALPHABET].sort());
  assert.deepEqual([...coveredDigraphs].sort(), [...ALBANIAN_DIGRAPHS].sort());
  assert.ok(ACCEPTED_GUESSES.size >= 14_000);
});

test("vendors the exact dictionary source used by the generator", async () => {
  const dictionary = await readFile("third_party/sq_AL/sq_AL.dic");
  const digest = createHash("sha256").update(dictionary).digest("hex");
  assert.equal(digest, DICTIONARY_SHA256);
});

test("vendors the exact affix source paired with the dictionary", async () => {
  const affix = await readFile("third_party/sq_AL/sq_AL.aff");
  const digest = createHash("sha256").update(affix).digest("hex");
  assert.equal(digest, AFFIX_SHA256);
});

test("accepts Hunspell-declared inflected forms and rejects junk", () => {
  // Each accepted probe names the dictionary root + affix flag that declares it.
  const declaredForms = [
    "shokun", // shok/P — SFX P adds "un" (accusative definite)
    "gjyshja", // gjyshe/S — SFX S strips "e", adds "ja" (definite feminine)
    "malet", // mal/N — SFX N adds "et" (plural definite)
    "detin", // det/K — SFX K adds "in" (accusative definite)
    "detit", // det/K — SFX K adds "it" (genitive/dative definite)
    "malit", // mal/K — SFX K adds "it" (genitive/dative definite)
    "gjyshen", // gjyshe/S — SFX S adds "n" (accusative definite)
    "detet", // det/N — SFX N adds "et" (plural definite)
    "shokët", // shok/M — SFX M adds "ët" (plural definite)
  ];
  for (const word of declaredForms) {
    assert.ok(
      ACCEPTED_WORD_SET.has(word),
      `${word} must be accepted as a declared Hunspell form`,
    );
  }

  const junk = ["xxxxx", "qqqqq", "zzzzz", "aaaaa", "bbbbb"];
  for (const word of junk) {
    assert.ok(!ACCEPTED_WORD_SET.has(word), `${word} must be rejected`);
  }
});

test("accepts every one of the 138 published answers as a guess", () => {
  assert.equal(ANSWERS.length, 138);
  for (const answer of ANSWERS) {
    assert.ok(
      ACCEPTED_GUESSES.has(answer.word),
      `${answer.word} must be accepted as a guess`,
    );
  }
});

test("pins the deliberate corpus size and version", () => {
  assert.equal(ACCEPTED_WORD_SET.size, EXPECTED_CORPUS_SIZE);
  assert.equal(CORPUS_VERSION, "2-hunspell-declared-2026-07-18");
});

test("regenerates the committed corpus byte-for-byte from vendored sources", async () => {
  // Determinism + max-delta guard: the committed src/accepted-words.js must be
  // exactly what the pure generator produces from the pinned .dic + .aff. Any
  // corpus change therefore requires a deliberate regeneration and review.
  const [dictionaryText, affText, committed] = await Promise.all([
    readFile("third_party/sq_AL/sq_AL.dic", "utf8"),
    readFile("third_party/sq_AL/sq_AL.aff", "utf8"),
    readFile("src/accepted-words.js", "utf8"),
  ]);

  const { words } = buildAcceptedWords(dictionaryText, affText);
  const regenerated = renderAcceptedWordsModule(words);

  assert.equal(words.length, EXPECTED_CORPUS_SIZE);
  assert.equal(
    regenerated,
    committed,
    "src/accepted-words.js is stale; rerun scripts/build-accepted-words.mjs",
  );
});
