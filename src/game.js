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
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : null;
}

function dateKeyOrdinal(key) {
  const [year, month, day] = key.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_IN_MILLISECONDS);
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
export function applyCompletedGameToProfile(
  profile,
  completion,
  completedPuzzlesCap = COMPLETED_PUZZLES_CAP,
) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    throw new TypeError("profile must be an object");
  }
  if (!completion || typeof completion !== "object" || Array.isArray(completion)) {
    throw new TypeError("completion must be an object");
  }

  const { puzzleId, mode, status, attemptCount, answerTokens, besa, usedHint } = completion;
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
    return { profile, recorded: false };
  }

  const next = {
    ...profile,
    distribution: [...profile.distribution],
    collection: [...profile.collection],
    completedPuzzles: [...profile.completedPuzzles, puzzleId].slice(-completedPuzzlesCap),
    dailyResults: { ...profile.dailyResults },
    modeStats: cloneModeStats(profile.modeStats),
  };

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
    next.collection = [
      ...new Set([...next.collection, ...answerTokens.map(normalizeWord)]),
    ].filter((letter) => ALBANIAN_LETTERS.has(letter));

    if (besa && !usedHint) {
      next.besaWins += 1;
    }
  }

  const trackedDate = completionDateKey(mode, puzzleId);
  if (trackedDate) {
    next.dailyResults[trackedDate] = status === "won" ? attemptCount : "X";
  }

  if (mode === "daily") {
    if (!trackedDate) {
      throw new RangeError("daily completion requires a dated puzzleId");
    }

    if (status === "won") {
      const dayDifference = next.lastDailyWin
        ? dateKeyOrdinal(trackedDate) - dateKeyOrdinal(next.lastDailyWin)
        : null;
      next.currentStreak = dayDifference === 1 ? next.currentStreak + 1 : 1;
      next.bestStreak = Math.max(next.bestStreak, next.currentStreak);
      next.lastDailyWin = trackedDate;
    } else {
      next.currentStreak = 0;
    }
  }

  return { profile: next, recorded: true };
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

  const match = code.trim().match(/^SQ-([0-9A-Z]+)$/i);
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
