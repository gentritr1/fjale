// Lexicon integrity gate, run as part of `npm run check` (before the tests).
//
// Hard errors (exit 1): structural facts that must never ship — id gaps,
// missing metadata, syllables that do not spell the word, answers that are not
// exactly five Albanian letter-tokens, duplicates.
//
// Warnings (exit 0, printed): editorial-balance findings a human must weigh —
// part-of-speech imbalance and clue/definition stem leaks. These block nothing
// but are the standing brief for the editorial review.
import { ALBANIAN_ALPHABET, tokenizeAlbanian } from "../src/game.js";
import { ANSWERS } from "../src/words.js";

const LETTERS = new Set(ALBANIAN_ALPHABET);
const REQUIRED_FIELDS = ["word", "partOfSpeech", "syllables", "clue", "definition", "example"];
const errors = [];
const warnings = [];

const seenWords = new Set();
ANSWERS.forEach((answer, position) => {
  const label = `#${answer.id} ${answer.word}`;

  if (answer.id !== position) {
    errors.push(`${label}: id must equal its array position (${position})`);
  }

  for (const field of REQUIRED_FIELDS) {
    if (typeof answer[field] !== "string" || answer[field].trim() === "") {
      errors.push(`${label}: missing or empty ${field}`);
    }
  }

  const tokens = tokenizeAlbanian(answer.word);
  if (tokens.length !== 5 || !tokens.every((token) => LETTERS.has(token))) {
    errors.push(`${label}: must be exactly five Albanian letter-tokens`);
  }

  if (typeof answer.syllables === "string" && answer.syllables.replaceAll("-", "") !== answer.word) {
    errors.push(`${label}: syllables "${answer.syllables}" do not spell the word`);
  }

  if (seenWords.has(answer.word)) {
    errors.push(`${label}: duplicate answer`);
  }
  seenWords.add(answer.word);

  // Review scar: clues that carry the answer's stem (FJALË, ROSAK) spoil the
  // hint. Only the clue is shown mid-game (the Gjurmë flow); definitions and
  // examples appear post-completion, so they may echo the word freely.
  const stem = answer.word.slice(0, 4);
  const clueText = (answer.clue ?? "").toLocaleLowerCase("sq-AL");
  if (stem.length === 4 && clueText.includes(stem)) {
    warnings.push(`${label}: clue contains the stem "${stem}" — hint leak`);
  }
});

// Part-of-speech balance, split into the published daily pool and the pending
// appended answers, so the editorial review sees where the imbalance lives.
function posBreakdown(entries) {
  const counts = new Map();
  for (const entry of entries) {
    counts.set(entry.partOfSpeech, (counts.get(entry.partOfSpeech) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([pos, count]) => `${pos}: ${count} (${Math.round((count / entries.length) * 100)}%)`)
    .join(", ");
}

const published = ANSWERS.filter((answer) => answer.id < 62);
const pending = ANSWERS.filter((answer) => answer.id >= 62);
console.log(`Lexicon: ${ANSWERS.length} answers (${published.length} published, ${pending.length} pending review)`);
console.log(`  published pool POS — ${posBreakdown(published)}`);
if (pending.length > 0) {
  console.log(`  pending POS — ${posBreakdown(pending)}`);
}

const nounShare = ANSWERS.filter((answer) => answer.partOfSpeech === "emër").length / ANSWERS.length;
if (nounShare > 0.75) {
  warnings.push(
    `catalog is ${Math.round(nounShare * 100)}% nouns — future additions should favor verbs, adjectives, and adverbs`,
  );
}

for (const warning of warnings) {
  console.warn(`WARNING: ${warning}`);
}
if (errors.length > 0) {
  for (const error of errors) {
    console.error(`ERROR: ${error}`);
  }
  process.exit(1);
}
console.log(`Lexicon validation passed (${warnings.length} warning${warnings.length === 1 ? "" : "s"}).`);
