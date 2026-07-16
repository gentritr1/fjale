export const ALBANIAN_DIGRAPHS = Object.freeze([
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

export const ALBANIAN_ALPHABET = Object.freeze([
  "a",
  "b",
  "c",
  "ç",
  "d",
  "dh",
  "e",
  "ë",
  "f",
  "g",
  "gj",
  "h",
  "i",
  "j",
  "k",
  "l",
  "ll",
  "m",
  "n",
  "nj",
  "o",
  "p",
  "q",
  "r",
  "rr",
  "s",
  "sh",
  "t",
  "th",
  "u",
  "v",
  "x",
  "xh",
  "y",
  "z",
  "zh",
]);

const ALBANIAN_LETTERS = new Set(ALBANIAN_ALPHABET);
const ALBANIAN_DIGRAPH_SET = new Set(ALBANIAN_DIGRAPHS);
const DIGRAPHS_LONGEST_FIRST = [...ALBANIAN_DIGRAPHS].sort(
  (left, right) => right.length - left.length,
);
const TIRANA_DATE_FORMATTER = new Intl.DateTimeFormat("en", {
  timeZone: "Europe/Tirane",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  numberingSystem: "latn",
});
const TIRANA_DATETIME_FORMATTER = new Intl.DateTimeFormat("en", {
  timeZone: "Europe/Tirane",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  numberingSystem: "latn",
});

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;
const DAILY_STEP_BASE = 37;
const DAILY_OFFSET = 911;
const CHALLENGE_PREFIX = "SQ";
const CHALLENGE_MULTIPLIER = 37;
const CHALLENGE_OFFSET = 911;

export function normalizeWord(word) {
  return String(word ?? "")
    .trim()
    .normalize("NFC")
    .toLocaleLowerCase("sq-AL")
    .normalize("NFC");
}

export function tokenizeAlbanian(word) {
  const normalized = normalizeWord(word);
  const tokens = [];

  for (let index = 0; index < normalized.length; ) {
    const digraph = DIGRAPHS_LONGEST_FIRST.find((candidate) =>
      normalized.startsWith(candidate, index),
    );

    if (digraph) {
      tokens.push(digraph);
      index += digraph.length;
      continue;
    }

    const character = String.fromCodePoint(normalized.codePointAt(index));
    tokens.push(character);
    index += character.length;
  }

  return tokens;
}

export function appendPhysicalCharacter(currentTokens, character, max = 5) {
  if (!Array.isArray(currentTokens)) {
    throw new TypeError("currentTokens must be an array");
  }

  if (!Number.isInteger(max) || max < 0) {
    throw new RangeError("max must be a non-negative integer");
  }

  const nextTokens = [...currentTokens];
  const typedTokens = tokenizeAlbanian(character);

  if (typedTokens.length !== 1 || !ALBANIAN_LETTERS.has(typedTokens[0])) {
    return nextTokens;
  }

  const typedToken = typedTokens[0];
  const lastIndex = nextTokens.length - 1;
  const lastToken = lastIndex >= 0 ? normalizeWord(nextTokens[lastIndex]) : "";
  const mergedToken = `${lastToken}${typedToken}`;

  // Physical keyboards emit the two characters separately. Merge the second
  // character before enforcing max so "s" + "h" still fits in a full row.
  if (ALBANIAN_DIGRAPH_SET.has(mergedToken)) {
    nextTokens[lastIndex] = mergedToken;
    return nextTokens;
  }

  if (nextTokens.length < max) {
    nextTokens.push(typedToken);
  }

  return nextTokens;
}

export function removeLastToken(tokens) {
  if (!Array.isArray(tokens)) {
    throw new TypeError("tokens must be an array");
  }

  return tokens.slice(0, -1);
}

export function evaluateGuess(answerTokens, guessTokens) {
  if (!Array.isArray(answerTokens) || !Array.isArray(guessTokens)) {
    throw new TypeError("answerTokens and guessTokens must be arrays");
  }

  if (answerTokens.length !== guessTokens.length) {
    throw new RangeError("answer and guess must contain the same number of tokens");
  }

  const answer = answerTokens.map(normalizeWord);
  const guess = guessTokens.map(normalizeWord);
  const result = Array(guess.length).fill("absent");
  const remaining = new Map();

  for (let index = 0; index < answer.length; index += 1) {
    if (answer[index] === guess[index]) {
      result[index] = "correct";
      continue;
    }

    remaining.set(answer[index], (remaining.get(answer[index]) ?? 0) + 1);
  }

  for (let index = 0; index < guess.length; index += 1) {
    if (result[index] === "correct") {
      continue;
    }

    const available = remaining.get(guess[index]) ?? 0;
    if (available > 0) {
      result[index] = "present";
      remaining.set(guess[index], available - 1);
    }
  }

  return result;
}

export function getTiranaDateKey(date = new Date()) {
  const parsedDate = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(parsedDate.getTime())) {
    throw new RangeError("date must be valid");
  }

  const parts = Object.fromEntries(
    TIRANA_DATE_FORMATTER.formatToParts(parsedDate).map((part) => [
      part.type,
      part.value,
    ]),
  );

  return `${parts.year}-${parts.month}-${parts.day}`;
}

function tiranaOffsetMs(epoch) {
  const parts = Object.fromEntries(
    TIRANA_DATETIME_FORMATTER.formatToParts(new Date(epoch)).map((part) => [
      part.type,
      part.value,
    ]),
  );

  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );

  return asUtc - epoch;
}

// Resolve the exact UTC instant of Europe/Tirane midnight for a wall-clock
// date. Correct across DST transitions: the local offset is measured at the
// candidate instant, then re-measured once in case the first guess landed in a
// different offset regime (midnight itself is never the skipped/repeated hour).
function tiranaMidnightEpoch(year, month, day) {
  const guess = Date.UTC(year, month - 1, day);
  const offset = tiranaOffsetMs(guess);
  let epoch = guess - offset;

  const refinedOffset = tiranaOffsetMs(epoch);
  if (refinedOffset !== offset) {
    epoch = guess - refinedOffset;
  }

  return epoch;
}

export function secondsUntilNextTiranaDay(date = new Date()) {
  const parsedDate = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(parsedDate.getTime())) {
    throw new RangeError("date must be valid");
  }

  const [year, month, day] = getTiranaDateKey(parsedDate).split("-").map(Number);
  const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
  const midnightEpoch = tiranaMidnightEpoch(
    nextDay.getUTCFullYear(),
    nextDay.getUTCMonth() + 1,
    nextDay.getUTCDate(),
  );

  return Math.max(0, Math.ceil((midnightEpoch - parsedDate.getTime()) / 1000));
}

export function getDailyIndex(date, count) {
  if (!Number.isSafeInteger(count) || count <= 0) {
    throw new RangeError("count must be a positive integer");
  }

  if (count === 1) {
    return 0;
  }

  const [year, month, day] = getTiranaDateKey(date).split("-").map(Number);
  const dayNumber = Math.floor(Date.UTC(year, month - 1, day) / DAY_IN_MILLISECONDS);
  let step = DAILY_STEP_BASE % count || 1;

  while (greatestCommonDivisor(step, count) !== 1) {
    step = (step + 1) % count || 1;
  }

  return ((dayNumber * step + DAILY_OFFSET) % count + count) % count;
}

function greatestCommonDivisor(left, right) {
  let a = left;
  let b = right;

  while (b !== 0) {
    [a, b] = [b, a % b];
  }

  return a;
}

// Validate a stored daily-results map: "YYYY-MM-DD" -> 1..maxGuesses (win in
// that many guesses) or "X" (loss). Invalid keys/values are dropped; any
// non-object input yields an empty map. Format validation only — the map is
// deliberately uncapped (one ~20-byte entry per played day).
export function sanitizeDailyResults(raw, maxGuesses = 6) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(raw).filter(
      ([key, value]) =>
        /^\d{4}-\d{2}-\d{2}$/.test(key) &&
        (value === "X" ||
          (Number.isInteger(value) && value >= 1 && value <= maxGuesses)),
    ),
  );
}

// The four game modes each keep an independent, honest statistics bucket. The
// legacy top-level profile fields stay as the "Overall" record; these buckets
// only start counting once per-mode tracking ships.
export const MODE_STATS_KEYS = Object.freeze([
  "daily",
  "archive",
  "practice",
  "challenge",
]);

// Stable identifiers for the post-game word ratings. The human-facing Albanian
// labels live in the UI layer; only these keys are persisted.
export const WORD_RATING_VALUES = Object.freeze([
  "e_drejte",
  "e_veshtire_por_e_drejte",
  "e_rralle",
  "nuk_e_njihja",
  "ka_gabim",
]);

const WORD_RATING_SET = new Set(WORD_RATING_VALUES);

function safeCount(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function emptyModeBucket(distributionLength) {
  return { played: 0, won: 0, distribution: Array(distributionLength).fill(0) };
}

// Build a fully zeroed modeStats object. Used both as the default for a fresh
// or legacy profile and as the skeleton sanitizeModeStats fills in.
export function createEmptyModeStats(distributionLength = 6) {
  return Object.fromEntries(
    MODE_STATS_KEYS.map((mode) => [mode, emptyModeBucket(distributionLength)]),
  );
}

// Validate a stored modeStats object. Every mode is always present; played/won
// are coerced to non-negative integers and distribution to a fixed-length array
// of non-negative integers. Any invalid shape collapses to zeros, so a legacy
// profile (no modeStats) yields an all-zero record rather than throwing.
export function sanitizeModeStats(raw, distributionLength = 6) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};

  return Object.fromEntries(
    MODE_STATS_KEYS.map((mode) => {
      const bucket = source[mode];
      const distributionSource = Array.isArray(bucket?.distribution)
        ? bucket.distribution
        : [];
      return [
        mode,
        {
          played: safeCount(bucket?.played),
          won: safeCount(bucket?.won),
          distribution: Array.from({ length: distributionLength }, (_, index) =>
            safeCount(distributionSource[index]),
          ),
        },
      ];
    }),
  );
}

// Validate a stored wordRatings map: puzzleId -> { word, rating, at }. Invalid
// entries are dropped; when more than `cap` valid entries exist the most recent
// (largest `at`) are kept. Non-object input yields an empty map.
export function sanitizeWordRatings(raw, cap = 500) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }

  const valid = Object.entries(raw).filter(
    ([key, value]) =>
      typeof key === "string" &&
      key.length > 0 &&
      key.length <= 100 &&
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof value.word === "string" &&
      value.word.length > 0 &&
      value.word.length <= 40 &&
      WORD_RATING_SET.has(value.rating) &&
      Number.isInteger(value.at) &&
      value.at > 0,
  );

  valid.sort((left, right) => right[1].at - left[1].at);

  return Object.fromEntries(
    valid
      .slice(0, Math.max(0, cap))
      .map(([key, value]) => [
        key,
        { word: value.word, rating: value.rating, at: value.at },
      ]),
  );
}

// Validate a stored reportedWords list: trimmed, non-empty strings, deduped
// (case-insensitively, Albanian locale), capped at `cap` keeping the most
// recently appended. Non-array input yields an empty list.
export function sanitizeReportedWords(raw, cap = 200) {
  if (!Array.isArray(raw)) {
    return [];
  }

  const seen = new Set();
  const cleaned = [];
  for (const entry of raw) {
    if (typeof entry !== "string") {
      continue;
    }
    const word = entry.trim();
    if (!word || word.length > 40) {
      continue;
    }
    const key = word.toLocaleLowerCase("sq-AL");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    cleaned.push(word);
  }

  return cleaned.slice(-Math.max(0, cap));
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) {
    throw new TypeError("seconds must be a finite number");
  }

  const totalSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;
  const paddedMinutes = String(minutes).padStart(2, "0");
  const paddedSeconds = String(remainingSeconds).padStart(2, "0");

  if (hours > 0) {
    return `${hours}:${paddedMinutes}:${paddedSeconds}`;
  }

  return `${paddedMinutes}:${paddedSeconds}`;
}

export function createChallengeCode(index) {
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new RangeError("index must be a non-negative safe integer");
  }

  const encodedIndex = index * CHALLENGE_MULTIPLIER + CHALLENGE_OFFSET;
  if (!Number.isSafeInteger(encodedIndex)) {
    throw new RangeError("index is too large to encode safely");
  }

  return `${CHALLENGE_PREFIX}-${encodedIndex.toString(36).toUpperCase()}`;
}

export function decodeChallengeCode(code, count) {
  if (!Number.isInteger(count) || count <= 0 || typeof code !== "string") {
    return null;
  }

  const match = code.trim().match(/^SQ-([0-9A-Z]+)$/i);
  if (!match) {
    return null;
  }

  const encodedIndex = Number.parseInt(match[1], 36);
  if (!Number.isSafeInteger(encodedIndex)) {
    return null;
  }

  const index = (encodedIndex - CHALLENGE_OFFSET) / CHALLENGE_MULTIPLIER;
  if (!Number.isSafeInteger(index) || index < 0 || index >= count) {
    return null;
  }

  return index;
}
