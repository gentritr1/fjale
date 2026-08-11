import {
  DEFAULT_AVATAR_ID,
  DEFAULT_LETTER_SEAL,
  isAvatarId,
} from "./avatars.js";

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
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const DAILY_STEP_BASE = 37;
const DAILY_OFFSET = 911;
const CHALLENGE_PREFIX = "SQ";
const CHALLENGE_MULTIPLIER = 37;
const CHALLENGE_CODE_MAX_LENGTH = 16;
export const COMPLETED_PUZZLES_CAP = 4_000;
const CHALLENGE_OFFSET = 911;

// Each epoch freezes the daily rotation for the span that starts on its Tirana
// date. The launch epoch uses the legacy leading-prefix poolSize. Future epochs
// may instead declare a frozen answerIds array so rejected catalog entries can
// be skipped without renumbering accepted answers. Appending never touches the
// words any earlier date resolved to, so history and shared challenge links stay
// byte-stable. Entries are ordered by ascending start, never overlap, and this
// table is append-only and reviewed (see tests).
export const DAILY_EPOCHS = Object.freeze([
  Object.freeze({ start: "2026-07-16", poolSize: 62, stepBase: 37, offset: 911 }),
  Object.freeze({
    start: "2026-07-23",
    answerIds: Object.freeze([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
      10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
      20, 21, 22, 23, 24, 25, 26, 27, 28, 29,
      30, 31, 32, 33, 34, 35, 36, 37, 38, 39,
      40, 41, 42, 43, 44, 45, 46, 47, 48, 49,
      50, 51, 52, 53, 54, 55, 56, 57, 58, 59,
      60, 61, 62, 63, 64, 65, 66, 67, 68, 69,
      70, 71, 72, 73, 74, 75, 76, 77, 78, 79,
      80, 81, 82, 83, 84, 85, 86, 87, 88, 89,
      90, 91, 92, 93, 94, 95, 96, 97, 98, 99,
      100, 101, 102, 103, 104, 105, 106, 107, 108, 109,
      110, 111, 112, 113, 114, 115, 116, 117, 118, 119,
      120, 121, 122, 123, 124, 125, 126, 127, 128, 129,
      130, 131, 132, 133, 134, 135, 136, 137,
    ]),
    poolSize: 138,
    stepBase: 37,
    offset: 911,
  }),
]);

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

export function replaceGuessToken(tokens, index, replacement) {
  if (!Array.isArray(tokens)) {
    throw new TypeError("tokens must be an array");
  }

  const nextTokens = [...tokens];
  if (!Number.isInteger(index) || index < 0 || index >= nextTokens.length) {
    return nextTokens;
  }

  const replacementTokens = tokenizeAlbanian(replacement);
  if (replacementTokens.length !== 1 || !ALBANIAN_LETTERS.has(replacementTokens[0])) {
    return nextTokens;
  }

  nextTokens[index] = replacementTokens[0];
  return nextTokens;
}

export function mergePhysicalCharacterAt(tokens, index, character) {
  if (!Array.isArray(tokens)) {
    throw new TypeError("tokens must be an array");
  }

  const nextTokens = [...tokens];
  if (!Number.isInteger(index) || index < 0 || index >= nextTokens.length) {
    return nextTokens;
  }

  const typedTokens = tokenizeAlbanian(character);
  if (typedTokens.length !== 1 || !ALBANIAN_LETTERS.has(typedTokens[0])) {
    return nextTokens;
  }

  const mergedToken = `${normalizeWord(nextTokens[index])}${typedTokens[0]}`;
  if (ALBANIAN_DIGRAPH_SET.has(mergedToken)) {
    nextTokens[index] = mergedToken;
  }

  return nextTokens;
}

export function removeGuessTokenAt(tokens, index) {
  if (!Array.isArray(tokens)) {
    throw new TypeError("tokens must be an array");
  }

  if (!Number.isInteger(index) || index < 0 || index >= tokens.length) {
    return [...tokens];
  }

  return [...tokens.slice(0, index), ...tokens.slice(index + 1)];
}

export function removeLastToken(tokens) {
  if (!Array.isArray(tokens)) {
    throw new TypeError("tokens must be an array");
  }

  return tokens.slice(0, -1);
}

export function hasSubmittedGuess(guesses, candidateTokens) {
  if (!Array.isArray(guesses) || !Array.isArray(candidateTokens)) {
    return false;
  }

  return guesses.some(
    (guess) =>
      Array.isArray(guess) &&
      guess.length === candidateTokens.length &&
      guess.every((token, index) => token === candidateTokens[index]),
  );
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
// Exported (body unchanged) so the Rrethi result write window can compute its
// 6-hour grace from the exact midnight instant instead of adding a second date
// implementation — PLAN-RRETHI-M1-API.md §5 and deviation D4. Plan §2.4 is
// explicit that a duplicate date implementation is how epochs drift.
export function tiranaMidnightEpoch(year, month, day) {
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

// Pure rotation math shared by getDailyIndex and the epoch-aware resolver. The
// index is a function of the Tirana calendar day and the (poolSize, stepBase,
// offset) triple only, so identical parameters always yield identical history.
function rotationIndex(date, poolSize, stepBase, offset) {
  if (!Number.isSafeInteger(poolSize) || poolSize <= 0) {
    throw new RangeError("count must be a positive integer");
  }

  if (poolSize === 1) {
    return 0;
  }

  const [year, month, day] = getTiranaDateKey(date).split("-").map(Number);
  const dayNumber = Math.floor(Date.UTC(year, month - 1, day) / DAY_IN_MILLISECONDS);
  let step = stepBase % poolSize || 1;

  while (greatestCommonDivisor(step, poolSize) !== 1) {
    step = (step + 1) % poolSize || 1;
  }

  return ((dayNumber * step + offset) % poolSize + poolSize) % poolSize;
}

export function getDailyIndex(date, count) {
  return rotationIndex(date, count, DAILY_STEP_BASE, DAILY_OFFSET);
}

// Pick the last epoch whose start date is on or before the Tirana date key.
// Dates before the first epoch clamp to it, preserving the pre-epoch behavior
// where the rotation was computed for any date (the archive UI already gates
// out dates earlier than the first published daily).
function dailyEpochFor(dateKey, epochs) {
  let selected = epochs[0];
  for (const epoch of epochs) {
    if (epoch.start <= dateKey) {
      selected = epoch;
    }
  }
  return selected;
}

// Explicit answer ids are authoritative when present. Keeping the list frozen
// makes the published pool immutable, while allowing an optional matching
// poolSize preserves compatibility with code that displays the active size.
function dailyEpochPool(epoch) {
  if (!Object.hasOwn(epoch, "answerIds")) {
    return { answerIds: null, poolSize: epoch.poolSize };
  }

  const { answerIds } = epoch;
  if (!Array.isArray(answerIds) || answerIds.length === 0) {
    throw new RangeError("epoch answerIds must be a nonempty array");
  }
  if (!Object.isFrozen(answerIds)) {
    throw new TypeError("epoch answerIds must be frozen");
  }

  const seen = new Set();
  for (const answerId of answerIds) {
    if (!Number.isSafeInteger(answerId) || answerId < 0) {
      throw new RangeError("epoch answerIds must contain non-negative safe integers");
    }
    if (seen.has(answerId)) {
      throw new RangeError("epoch answerIds must be unique");
    }
    seen.add(answerId);
  }

  const poolSize = answerIds.length;
  if (Object.hasOwn(epoch, "poolSize") && epoch.poolSize !== poolSize) {
    throw new RangeError("epoch poolSize must match answerIds.length");
  }

  return { answerIds, poolSize };
}

// The epoch that governs today's daily word. app.js derives DAILY_POOL_SIZE
// from this so the pool size has a single source of truth (the epoch table).
export function getActiveDailyEpoch(date = new Date(), epochs = DAILY_EPOCHS) {
  const epoch = dailyEpochFor(getTiranaDateKey(date), epochs);
  const { answerIds, poolSize } = dailyEpochPool(epoch);

  if (answerIds && !Object.hasOwn(epoch, "poolSize")) {
    return Object.freeze({ ...epoch, poolSize });
  }

  return epoch;
}

// Resolve the daily answer id for a date through the epoch table. The returned
// value is either the legacy leading-prefix index or an immutable id selected
// from an explicit answerIds pool. With only the launch epoch present this is
// identical to getDailyIndex(date, 62) for every date, so no historical daily
// word or challenge link shifts.
export function getDailyAnswerIndex(date, epochs = DAILY_EPOCHS) {
  const epoch = dailyEpochFor(getTiranaDateKey(date), epochs);
  const { answerIds, poolSize } = dailyEpochPool(epoch);
  const rotationPosition = rotationIndex(
    date,
    poolSize,
    epoch.stepBase,
    epoch.offset,
  );

  return answerIds ? answerIds[rotationPosition] : rotationPosition;
}

function greatestCommonDivisor(left, right) {
  let a = left;
  let b = right;

  while (b !== 0) {
    [a, b] = [b, a % b];
  }

  return a;
}

// Validate a stored daily-results map: real "YYYY-MM-DD" calendar date ->
// 1..maxGuesses (win in that many guesses) or "X" (loss). Invalid keys/values
// are dropped; any non-object input yields an empty map. The map is deliberately
// uncapped (one ~20-byte entry per played day).
export function sanitizeDailyResults(raw, maxGuesses = 6) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(raw).filter(
      ([key, value]) =>
        isDateKey(key) &&
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

// Streak grace: exactly one missed day is forgiven automatically, at most once
// per rolling 30 Tirana days. It is free, never announced in advance, and never
// stacked — two consecutive missed days always break the streak. Grace forgives
// absence, not loss: a played-and-lost day already reset the streak and must
// never spend the grace day.
export const STREAK_GRACE_WINDOW_DAYS = 30;

// Milestones are the once-ever moments (plan §4.4 tier 3). Recorded in an
// additive, append-only profile.milestones array so the celebration for one can
// never fire twice. Ids are stable keys; the Albanian labels live in the UI.
export const MILESTONE_IDS = Object.freeze([
  "streak-7",
  "streak-30",
  "streak-100",
  "digraphs-9",
  "letters-36",
  "besa-first",
  "daily-wins-100",
]);

// The eleven locally computable badges (plan §4.5, rows 1–11; row 12 is
// server-derived and Rrethi-gated, so it is not computed here). Badges are
// derived from stored totals rather than persisted, which is what guarantees
// that one can never be lost once earned.
export const BADGE_IDS = Object.freeze([
  "daily-win-1",
  "daily-attempt-1",
  "daily-attempt-6",
  "daily-fast-10",
  "streak-7",
  "streak-30",
  "daily-played-100",
  "daily-win-25",
  "digraphs-9",
  "letters-36",
  "daily-besa-3",
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
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
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

// Validate a stored milestone list: known ids only, deduped, original order
// preserved. Non-array input yields an empty list. The list is append-only by
// contract — nothing in this module ever removes an id from it.
export function sanitizeMilestones(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }

  const known = new Set(MILESTONE_IDS);
  const seen = new Set();
  const kept = [];
  for (const id of raw) {
    if (typeof id !== "string" || !known.has(id) || seen.has(id)) {
      continue;
    }
    seen.add(id);
    kept.push(id);
  }

  return kept;
}

// Validate a persisted profile into the exact shape the game layer expects.
// Every field is defaulted, so a legacy save loads with all recognized totals
// intact and unknown-to-it fields (besaDailyWins, lastGraceDate, milestones)
// simply default — additive, never destructive, no wipe risk.
export function sanitizeProfile(
  saved,
  rowCount = 6,
  completedPuzzlesCap = COMPLETED_PUZZLES_CAP,
) {
  const source = saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
  const distribution = Array.isArray(source.distribution)
    ? Array.from({ length: rowCount }, (_, index) => safeCount(source.distribution[index]))
    : Array(rowCount).fill(0);
  const collection = Array.isArray(source.collection)
    ? [
        ...new Set(
          source.collection
            .map(normalizeWord)
            .filter((letter) => ALBANIAN_LETTERS.has(letter)),
        ),
      ]
    : [];
  const completedPuzzles = Array.isArray(source.completedPuzzles)
    ? source.completedPuzzles
        .filter((id) => typeof id === "string" && id.length > 0 && id.length <= 100)
        .slice(-completedPuzzlesCap)
    : [];
  const letterSeal = normalizeWord(source.letterSeal);

  return {
    played: safeCount(source.played),
    won: safeCount(source.won),
    currentStreak: safeCount(source.currentStreak),
    bestStreak: safeCount(source.bestStreak),
    lastDailyWin: isDateKey(source.lastDailyWin) ? source.lastDailyWin : null,
    lastWinGuesses: Number.isInteger(source.lastWinGuesses) ? source.lastWinGuesses : null,
    besaWins: safeCount(source.besaWins),
    // Additive: Besa wins earned in the daily mode only. The legacy besaWins
    // counts every mode and is deliberately left alone so no profile loses a
    // total it already has (plan §4.5).
    besaDailyWins: safeCount(source.besaDailyWins),
    // Additive: the missed day forgiven by the rolling grace window, or null.
    lastGraceDate: isDateKey(source.lastGraceDate) ? source.lastGraceDate : null,
    // Additive: once-ever milestone ids, append-only.
    milestones: sanitizeMilestones(source.milestones),
    // Additive local identity for the future Rrethi UI. Both values are drawn
    // from closed catalogs, so storage can never inject an arbitrary image URL
    // or an unsupported seal into the DOM.
    avatarId: isAvatarId(source.avatarId) ? source.avatarId : DEFAULT_AVATAR_ID,
    letterSeal: ALBANIAN_LETTERS.has(letterSeal) ? letterSeal : DEFAULT_LETTER_SEAL,
    distribution,
    collection,
    completedPuzzles,
    // Additive field: old profiles simply produce an empty map, no data loss.
    dailyResults: sanitizeDailyResults(source.dailyResults, rowCount),
    // Additive per-mode statistics. A legacy profile with no modeStats yields an
    // all-zero record; the legacy top-level fields above remain the "Overall".
    modeStats: sanitizeModeStats(source.modeStats, rowCount),
    // Additive trust fields; both default to empty for legacy profiles.
    wordRatings: sanitizeWordRatings(source.wordRatings),
    reportedWords: sanitizeReportedWords(source.reportedWords),
  };
}

function cloneModeStats(modeStats) {
  return Object.fromEntries(
    MODE_STATS_KEYS.map((mode) => {
      const bucket = modeStats[mode];
      return [
        mode,
        {
          played: bucket.played,
          won: bucket.won,
          distribution: [...bucket.distribution],
        },
      ];
    }),
  );
}

function completionDateKey(mode, puzzleId) {
  const prefix = mode === "daily" ? "daily-" : mode === "archive" ? "archive-" : null;
  if (!prefix || !puzzleId.startsWith(prefix)) {
    return null;
  }

  const key = puzzleId.slice(prefix.length);
  return isDateKey(key) ? key : null;
}

function isDateKey(value) {
  if (typeof value !== "string" || !DATE_KEY_PATTERN.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || year > 9999) {
    return false;
  }
  const candidate = new Date(0);
  candidate.setUTCHours(0, 0, 0, 0);
  candidate.setUTCFullYear(year, month - 1, day);
  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  );
}

// Calendar-day arithmetic on "YYYY-MM-DD" keys. The keys themselves always come
// from getTiranaDateKey, so the zone is already resolved and these two are pure
// UTC-ordinal conversions — never a second time-zone implementation.
export function dateKeyOrdinal(key) {
  if (!isDateKey(key)) {
    throw new RangeError("key must be a real YYYY-MM-DD calendar date");
  }
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return Math.floor(date.getTime() / DAY_IN_MILLISECONDS);
}

export function dateKeyFromOrdinal(ordinal) {
  if (!Number.isSafeInteger(ordinal)) {
    throw new RangeError("ordinal must be a safe integer");
  }
  const date = new Date(ordinal * DAY_IN_MILLISECONDS);
  const year = date.getUTCFullYear();
  if (!Number.isFinite(date.getTime()) || year < 1 || year > 9999) {
    throw new RangeError("ordinal must resolve to a four-digit calendar year");
  }
  const paddedYear = String(year).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${paddedYear}-${month}-${day}`;
}

// The rolling grace window: a grace day is available when none was consumed in
// the previous STREAK_GRACE_WINDOW_DAYS days, counted from the day being
// resolved. Consuming one records the missed day, so consecutive misses can
// never both be forgiven.
export function isStreakGraceAvailable(
  profile,
  dateKey,
  windowDays = STREAK_GRACE_WINDOW_DAYS,
) {
  const lastGraceDate = profile?.lastGraceDate;
  if (!isDateKey(lastGraceDate) || !isDateKey(dateKey)) {
    return true;
  }

  return dateKeyOrdinal(dateKey) - dateKeyOrdinal(lastGraceDate) > windowDays;
}

// Resolve a stored streak against today without recording anything: a gap of
// one day is still live, a gap of two survives only while the grace day is
// available (it is spent when the day is actually completed), and anything
// larger is over. Returns a new profile when the streak expired, mirroring the
// no-mutation contract of applyCompletedGameToProfile.
export function normalizeStreakForDate(profile, dateKey, options = {}) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    throw new TypeError("profile must be an object");
  }
  if (!isDateKey(dateKey)) {
    throw new RangeError("dateKey must be a YYYY-MM-DD key");
  }
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("options must be an object");
  }

  const streakGraceEnabled = Boolean(options.streakGraceEnabled);

  if (!isDateKey(profile.lastDailyWin) || safeCount(profile.currentStreak) === 0) {
    return { profile, changed: false };
  }

  const difference = dateKeyOrdinal(dateKey) - dateKeyOrdinal(profile.lastDailyWin);
  const survives =
    difference <= 1 ||
    (streakGraceEnabled && difference === 2 && isStreakGraceAvailable(profile, dateKey));
  if (survives) {
    return { profile, changed: false };
  }

  return { profile: { ...profile, currentStreak: 0 }, changed: true };
}

function collectedTokenSet(profile) {
  return new Set(
    Array.isArray(profile?.collection) ? profile.collection.map(normalizeWord) : [],
  );
}

function countCollected(profile, tokens) {
  const collected = collectedTokenSet(profile);
  return tokens.filter((token) => collected.has(token)).length;
}

function modeBucketOf(profile, mode) {
  const bucket = profile?.modeStats?.[mode];
  return {
    played: safeCount(bucket?.played),
    won: safeCount(bucket?.won),
    distribution: Array.isArray(bucket?.distribution)
      ? bucket.distribution.map(safeCount)
      : [],
  };
}

// Every daily count reads modeStats.daily, never dailyResults: an archive play
// for date D writes dailyResults[D] too (see completionDateKey), so dailyResults
// is not mode-isolated and would inflate daily badges (plan §4.5).
function badgeProgress(profile) {
  const daily = modeBucketOf(profile, "daily");
  const inThreeOrFewer = daily.distribution
    .slice(0, 3)
    .reduce((total, count) => total + count, 0);

  return {
    "daily-win-1": { current: daily.won, target: 1 },
    "daily-attempt-1": { current: daily.distribution[0] ?? 0, target: 1 },
    "daily-attempt-6": { current: daily.distribution[5] ?? 0, target: 1 },
    "daily-fast-10": { current: inThreeOrFewer, target: 10 },
    "streak-7": { current: safeCount(profile?.bestStreak), target: 7 },
    "streak-30": { current: safeCount(profile?.bestStreak), target: 30 },
    "daily-played-100": { current: daily.played, target: 100 },
    "daily-win-25": { current: daily.won, target: 25 },
    "digraphs-9": {
      current: countCollected(profile, ALBANIAN_DIGRAPHS),
      target: ALBANIAN_DIGRAPHS.length,
    },
    "letters-36": {
      current: countCollected(profile, ALBANIAN_ALPHABET),
      target: ALBANIAN_ALPHABET.length,
    },
    "daily-besa-3": { current: safeCount(profile?.besaDailyWins), target: 3 },
  };
}

// Pure badge evaluation over a profile. Progress is returned with the earned
// state so the UI can show a concrete next step without re-deriving thresholds.
export function computeEarnedBadges(profile) {
  const progress = badgeProgress(profile);
  return BADGE_IDS.map((id) => {
    const { current, target } = progress[id];
    return { id, current, target, earned: current >= target };
  });
}

// A milestone's condition is the same kind of monotonic read as a badge, so a
// milestone can never un-earn itself. Streak milestones read bestStreak, which
// only grows, and the Besa milestone reads the strict daily counter.
function satisfiedMilestoneIds(profile) {
  const daily = modeBucketOf(profile, "daily");
  const satisfied = {
    "streak-7": safeCount(profile?.bestStreak) >= 7,
    "streak-30": safeCount(profile?.bestStreak) >= 30,
    "streak-100": safeCount(profile?.bestStreak) >= 100,
    "digraphs-9": countCollected(profile, ALBANIAN_DIGRAPHS) === ALBANIAN_DIGRAPHS.length,
    "letters-36": countCollected(profile, ALBANIAN_ALPHABET) === ALBANIAN_ALPHABET.length,
    "besa-first": safeCount(profile?.besaDailyWins) >= 1,
    "daily-wins-100": daily.won >= 100,
  };

  return MILESTONE_IDS.filter((id) => satisfied[id]);
}

function emptyCompletionEvents() {
  return {
    mode: null,
    status: null,
    newLetters: [],
    newMilestones: [],
    besaDaily: false,
    streak: {
      previous: 0,
      current: 0,
      changed: false,
      continued: false,
      graceUsed: false,
      broken: false,
    },
  };
}

export function getAttemptCount(guessCount, usedAttemptForHint = false) {
  if (!Number.isInteger(guessCount) || guessCount < 0) {
    throw new RangeError("guessCount must be a non-negative integer");
  }

  return guessCount + Number(Boolean(usedAttemptForHint));
}

export function formatHintMetadata(partOfSpeech, syllables) {
  if (typeof partOfSpeech !== "string" || partOfSpeech.trim() === "") {
    throw new TypeError("partOfSpeech must be a non-empty string");
  }
  if (typeof syllables !== "string" || syllables.trim() === "") {
    throw new TypeError("syllables must be a non-empty string");
  }

  const syllableCount = syllables.split("-").filter(Boolean).length;
  if (syllableCount < 1) {
    throw new RangeError("syllables must contain at least one syllable");
  }

  return `${partOfSpeech.trim()} · ${syllableCount} rrokje`;
}

// Apply one finished puzzle to an already-sanitized profile without mutating
// either input. Keeping this transition in the game layer makes mode isolation,
// deduplication, streak behavior, and legacy Overall totals directly testable.
//
// Returns { profile, recorded, events }. `events` is the completion contract the
// celebration layer consumes — everything it needs is computed here, so no UI
// code ever re-derives a diff or a threshold:
//
//   events.mode           the completed mode ("daily" | "archive" | ...)
//   events.status         "won" | "lost"
//   events.newLetters     letters this completion added to profile.collection,
//                         in collection order (drives stamp-land; [] when none)
//   events.newMilestones  milestone ids crossed BY this completion, in
//                         MILESTONE_IDS order (drives milestone-band + the
//                         tier-3 confetti). Milestones a profile already
//                         satisfied before this completion are backfilled into
//                         profile.milestones silently and never appear here, so
//                         a legacy profile cannot trigger a burst of stale
//                         celebrations.
//   events.besaDaily      true for a daily win with Besa declared and no hint
//                         (drives besa-seal-press)
//   events.streak         { previous, current, changed, continued, graceUsed,
//                           broken } — `continued` is a daily win that extended
//                         a running streak (including one saved by the grace
//                         day), `graceUsed` means this completion spent the
//                         rolling grace day, `broken` is a daily completion that
//                         ended a running streak.
//
// A duplicate completion (recorded === false) returns a neutral events object,
// so replaying a finished puzzle can never re-fire a celebration.
export function applyCompletedGameToProfile(
  profile,
  completion,
  completedPuzzlesCap = COMPLETED_PUZZLES_CAP,
  options = {},
) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    throw new TypeError("profile must be an object");
  }
  if (!completion || typeof completion !== "object" || Array.isArray(completion)) {
    throw new TypeError("completion must be an object");
  }
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("options must be an object");
  }

  const { puzzleId, mode, status, attemptCount, answerTokens, besa, usedHint } = completion;
  const streakGraceEnabled = Boolean(options.streakGraceEnabled);
  if (typeof puzzleId !== "string" || puzzleId.length === 0 || puzzleId.length > 100) {
    throw new RangeError("completion puzzleId must be a non-empty string");
  }
  if (!MODE_STATS_KEYS.includes(mode)) {
    throw new RangeError("completion mode is invalid");
  }
  if (!["won", "lost"].includes(status)) {
    throw new RangeError("completion status is invalid");
  }
  if (!Number.isInteger(completedPuzzlesCap) || completedPuzzlesCap < 1) {
    throw new RangeError("completedPuzzlesCap must be a positive integer");
  }
  if (!Array.isArray(profile.completedPuzzles)) {
    throw new TypeError("profile.completedPuzzles must be an array");
  }

  if (profile.completedPuzzles.includes(puzzleId)) {
    return { profile, recorded: false, events: emptyCompletionEvents() };
  }

  const next = {
    ...profile,
    // The additive reward fields are normalized here too, so a completion
    // applied to a profile that predates them still persists a valid shape.
    besaDailyWins: safeCount(profile.besaDailyWins),
    lastGraceDate: isDateKey(profile.lastGraceDate) ? profile.lastGraceDate : null,
    milestones: sanitizeMilestones(profile.milestones),
    distribution: [...profile.distribution],
    collection: [...profile.collection],
    completedPuzzles: [...profile.completedPuzzles, puzzleId].slice(-completedPuzzlesCap),
    dailyResults: { ...profile.dailyResults },
    modeStats: cloneModeStats(profile.modeStats),
  };
  const previousCollection = new Set(profile.collection);
  const previousStreak = safeCount(profile.currentStreak);

  next.played += 1;
  const modeBucket = next.modeStats[mode];
  modeBucket.played += 1;

  if (status === "won") {
    if (!Number.isInteger(attemptCount) || attemptCount < 1 || attemptCount > next.distribution.length) {
      throw new RangeError("won completion attemptCount is outside the distribution");
    }
    if (!Array.isArray(answerTokens)) {
      throw new TypeError("won completion answerTokens must be an array");
    }

    next.won += 1;
    next.distribution[attemptCount - 1] += 1;
    next.lastWinGuesses = attemptCount;
    modeBucket.won += 1;
    modeBucket.distribution[attemptCount - 1] += 1;
    // The alphabet passport is a daily ritual, not a grindable collection.
    // Archive, Practice, and Challenge still keep their own honest statistics,
    // but only a win on today's Daily word may add letter stamps.
    if (mode === "daily") {
      next.collection = [
        ...new Set([...next.collection, ...answerTokens.map(normalizeWord)]),
      ].filter((letter) => ALBANIAN_LETTERS.has(letter));
    }

    if (besa && !usedHint) {
      next.besaWins = safeCount(next.besaWins) + 1;
      // besaWins stays mode-agnostic so no profile loses the total it already
      // has; besaDailyWins is the strict daily counter new profiles build up.
      if (mode === "daily") {
        next.besaDailyWins += 1;
      }
    }
  }

  const trackedDate = completionDateKey(mode, puzzleId);
  if (trackedDate) {
    next.dailyResults[trackedDate] = status === "won" ? attemptCount : "X";
  }

  let graceUsed = false;
  let streakContinued = false;

  if (mode === "daily") {
    if (!trackedDate) {
      throw new RangeError("daily completion requires a dated puzzleId");
    }

    if (status === "won") {
      const dayDifference = next.lastDailyWin
        ? dateKeyOrdinal(trackedDate) - dateKeyOrdinal(next.lastDailyWin)
        : null;

      if (dayDifference === 1) {
        next.currentStreak = previousStreak + 1;
        streakContinued = true;
      } else if (
        // One missed day is forgiven when the rolling grace day is available
        // and a streak is actually running. A played-and-lost day has already
        // set currentStreak to 0, so this branch cannot fire for it: grace
        // forgives absence, never a loss, and is never spent on one.
        dayDifference === 2 &&
        streakGraceEnabled &&
        previousStreak > 0 &&
        isStreakGraceAvailable(next, trackedDate)
      ) {
        next.currentStreak = previousStreak + 1;
        next.lastGraceDate = dateKeyFromOrdinal(dateKeyOrdinal(trackedDate) - 1);
        graceUsed = true;
        streakContinued = true;
      } else {
        next.currentStreak = 1;
      }

      next.bestStreak = Math.max(next.bestStreak, next.currentStreak);
      next.lastDailyWin = trackedDate;
    } else {
      next.currentStreak = 0;
    }
  }

  // Milestones already satisfied before this completion are backfilled without
  // being surfaced; only genuinely crossed ones become events. The list is
  // append-only, so an id recorded once is never written again.
  const recordedMilestones = new Set(next.milestones);
  const previouslySatisfied = new Set(satisfiedMilestoneIds(profile));
  const backfilled = [...previouslySatisfied].filter((id) => !recordedMilestones.has(id));
  const newMilestones = satisfiedMilestoneIds(next).filter(
    (id) => !recordedMilestones.has(id) && !previouslySatisfied.has(id),
  );
  next.milestones = [
    ...next.milestones,
    ...MILESTONE_IDS.filter((id) => backfilled.includes(id)),
    ...newMilestones,
  ];

  const events = {
    mode,
    status,
    newLetters: next.collection.filter((letter) => !previousCollection.has(letter)),
    newMilestones,
    besaDaily: mode === "daily" && status === "won" && Boolean(besa) && !usedHint,
    streak: {
      previous: previousStreak,
      current: next.currentStreak,
      changed: next.currentStreak !== previousStreak,
      continued: streakContinued,
      graceUsed,
      broken: mode === "daily" && previousStreak > 0 && !streakContinued,
    },
  };

  return { profile: next, recorded: true, events };
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

// Challenge codes encode an immutable answer id (today equal to the answer's
// array position, so every code shared in the wild still decodes to the same
// word). The wire format — SQ- prefix, id * 37 + 911, base36 uppercase — is
// frozen; callers resolve the decoded id through getAnswerById, not array index.
export function createChallengeCode(id) {
  if (!Number.isSafeInteger(id) || id < 0) {
    throw new RangeError("id must be a non-negative safe integer");
  }

  const encoded = id * CHALLENGE_MULTIPLIER + CHALLENGE_OFFSET;
  if (!Number.isSafeInteger(encoded)) {
    throw new RangeError("id is too large to encode safely");
  }

  return `${CHALLENGE_PREFIX}-${encoded.toString(36).toUpperCase()}`;
}

// Decode a challenge code back to an answer id. `count` is the number of valid
// ids (the catalog size); an id outside [0, count) is rejected as unknown.
export function decodeChallengeCode(code, count) {
  if (!Number.isInteger(count) || count <= 0 || typeof code !== "string") {
    return null;
  }

  const normalized = code.trim();
  if (normalized.length === 0 || normalized.length > CHALLENGE_CODE_MAX_LENGTH) {
    return null;
  }

  const match = normalized.match(/^SQ-([0-9A-Z]+)$/i);
  if (!match) {
    return null;
  }

  const encoded = Number.parseInt(match[1], 36);
  if (!Number.isSafeInteger(encoded)) {
    return null;
  }

  const id = (encoded - CHALLENGE_OFFSET) / CHALLENGE_MULTIPLIER;
  if (!Number.isSafeInteger(id) || id < 0 || id >= count) {
    return null;
  }

  return id;
}
