import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { ALBANIAN_ALPHABET, ALBANIAN_DIGRAPHS, tokenizeAlbanian } from "../src/game.js";
import { ACCEPTED_GUESSES, ANSWERS } from "../src/words.js";

const DAILY_V1_CATALOG_SHA256 =
  "9a347248a5e4e43fdecae1c9c6afc503fb36054d055651eb398e932af0ff25dd";
const LEGACY_CHALLENGE_CATALOG_SHA256 =
  "67edd1a27dd062dc2742236d21b7098f2d187abb51d919fe417ca5f73b7877b6";
const DICTIONARY_SHA256 =
  "8fba63fcf7320910803739cc2f0475224a7e8f38f696963d0968e6122a7c0343";

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
