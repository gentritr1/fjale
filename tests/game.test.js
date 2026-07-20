import test from "node:test";
import assert from "node:assert/strict";

import {
  ALBANIAN_ALPHABET,
  ALBANIAN_DIGRAPHS,
  applyCompletedGameToProfile,
  appendPhysicalCharacter,
  createChallengeCode,
  createEmptyModeStats,
  DAILY_EPOCHS,
  decodeChallengeCode,
  evaluateGuess,
  formatDuration,
  formatHintMetadata,
  getActiveDailyEpoch,
  getAttemptCount,
  getDailyAnswerIndex,
  getDailyIndex,
  getTiranaDateKey,
  MODE_STATS_KEYS,
  normalizeWord,
  removeLastToken,
  sanitizeDailyResults,
  sanitizeModeStats,
  sanitizeReportedWords,
  sanitizeWordRatings,
  secondsUntilNextTiranaDay,
  tokenizeAlbanian,
  WORD_RATING_VALUES,
} from "../src/game.js";
import { getAnswerById } from "../src/words.js";

function createProfile(overrides = {}) {
  return {
    played: 10,
    won: 7,
    currentStreak: 3,
    bestStreak: 5,
    lastDailyWin: "2026-07-16",
    lastWinGuesses: 4,
    besaWins: 2,
    distribution: [0, 1, 2, 2, 1, 1],
    collection: ["a", "n"],
    completedPuzzles: ["daily-2026-07-16"],
    dailyResults: { "2026-07-16": 4 },
    modeStats: createEmptyModeStats(),
    wordRatings: {},
    reportedWords: [],
    ...overrides,
  };
}

test("exports the 36-letter Albanian alphabet with all nine digraphs", () => {
  assert.equal(ALBANIAN_ALPHABET.length, 36);
  assert.deepEqual(ALBANIAN_DIGRAPHS, [
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
  assert.ok(ALBANIAN_ALPHABET.includes("ç"));
  assert.ok(ALBANIAN_ALPHABET.includes("ë"));
  assert.ok(ALBANIAN_DIGRAPHS.every((token) => ALBANIAN_ALPHABET.includes(token)));
});

test("normalizeWord trims, lowercases, and NFC-normalizes Ë and Ç", () => {
  assert.equal(normalizeWord("  C\u0327ELE\u0308S  "), "çelës");
  assert.equal(normalizeWord("ËNDRRA"), "ëndrra");
});

test("tokenizeAlbanian uses Albanian digraphs as single, longest-first tokens", () => {
  assert.deepEqual(tokenizeAlbanian("GJYSHJA"), ["gj", "y", "sh", "j", "a"]);
  assert.deepEqual(tokenizeAlbanian("XHAXHA"), ["xh", "a", "xh", "a"]);
  assert.deepEqual(tokenizeAlbanian("DHELPËR"), ["dh", "e", "l", "p", "ë", "r"]);
});

test("getAttemptCount charges exactly one attempt for a revealed hint", () => {
  assert.equal(getAttemptCount(3), 3);
  assert.equal(getAttemptCount(3, true), 4);
  assert.equal(getAttemptCount(5, false), 5);
  assert.throws(() => getAttemptCount(-1), RangeError);
  assert.throws(() => getAttemptCount(1.5), RangeError);
});

test("formatHintMetadata reports only the syllable count during play", () => {
  assert.equal(formatHintMetadata("emër", "bu-xhet"), "emër · 2 rrokje");
  assert.equal(formatHintMetadata("folje", "ha"), "folje · 1 rrokje");
  assert.doesNotMatch(formatHintMetadata("emër", "a-ni-je"), /a-ni-je/u);
  assert.throws(() => formatHintMetadata("", "bu-xhet"), TypeError);
});

test("appendPhysicalCharacter merges separately typed digraphs without mutation", () => {
  const original = ["a", "b", "c", "d", "s"];
  const merged = appendPhysicalCharacter(original, "H");

  assert.deepEqual(original, ["a", "b", "c", "d", "s"]);
  assert.deepEqual(merged, ["a", "b", "c", "d", "sh"]);
  assert.deepEqual(appendPhysicalCharacter(merged, "a"), merged);
  assert.deepEqual(appendPhysicalCharacter([], "E\u0308"), ["ë"]);
  assert.deepEqual(appendPhysicalCharacter(["ç"], "!"), ["ç"]);
});

test("removeLastToken removes one Albanian letter, including a whole digraph", () => {
  const tokens = ["gj", "y", "sh"];
  assert.deepEqual(removeLastToken(tokens), ["gj", "y"]);
  assert.deepEqual(tokens, ["gj", "y", "sh"]);
  assert.deepEqual(removeLastToken([]), []);
});

test("evaluateGuess gives exact matches priority when letters repeat", () => {
  assert.deepEqual(
    evaluateGuess(
      ["a", "r", "a", "s", "t"],
      ["a", "a", "a", "r", "r"],
    ),
    ["correct", "absent", "correct", "present", "absent"],
  );
});

test("evaluateGuess treats Albanian digraphs and accented letters as atomic", () => {
  assert.deepEqual(
    evaluateGuess(
      ["gj", "y", "sh", "ç", "ë"],
      ["sh", "y", "gj", "ç", "ë"],
    ),
    ["present", "correct", "present", "correct", "correct"],
  );
});

test("getTiranaDateKey follows summer and winter midnight in Europe/Tirane", () => {
  assert.equal(getTiranaDateKey(new Date("2026-07-15T21:59:59Z")), "2026-07-15");
  assert.equal(getTiranaDateKey(new Date("2026-07-15T22:00:00Z")), "2026-07-16");
  assert.equal(getTiranaDateKey(new Date("2026-01-01T22:59:59Z")), "2026-01-01");
  assert.equal(getTiranaDateKey(new Date("2026-01-01T23:00:00Z")), "2026-01-02");
});

test("getDailyIndex is stable within a Tirana day and changes on the next day", () => {
  const count = 997;
  const beforeMidnight = getDailyIndex(new Date("2026-07-15T21:59:59Z"), count);
  const afterMidnight = getDailyIndex(new Date("2026-07-15T22:00:00Z"), count);
  const laterSameDay = getDailyIndex(new Date("2026-07-16T12:00:00Z"), count);

  assert.equal(laterSameDay, afterMidnight);
  assert.notEqual(afterMidnight, beforeMidnight);
  assert.equal(getDailyIndex(new Date("2026-07-16T12:00:00Z"), 1), 0);
});

test("getDailyIndex uses every answer once before the daily pool repeats", () => {
  const count = 62;
  const start = Date.parse("2026-01-10T12:00:00Z");
  const indices = Array.from({ length: count }, (_, offset) =>
    getDailyIndex(new Date(start + offset * 86_400_000), count),
  );

  assert.equal(new Set(indices).size, count);
});

test("secondsUntilNextTiranaDay counts down to the next Tirana midnight on a normal day", () => {
  // 2026-01-10 13:00 Tirana (CET, UTC+1); next midnight is 2026-01-11 00:00 CET.
  assert.equal(
    secondsUntilNextTiranaDay(new Date("2026-01-10T12:00:00Z")),
    11 * 3600,
  );
  // One second before midnight resolves to exactly one second.
  assert.equal(
    secondsUntilNextTiranaDay(new Date("2026-01-10T22:59:59Z")),
    1,
  );
});

test("secondsUntilNextTiranaDay handles the spring-forward day as 23 hours", () => {
  // Europe/Tirane springs forward on 2026-03-29 (02:00 CET -> 03:00 CEST).
  // Tirana midnight 2026-03-29 00:00 (CET) == 2026-03-28T23:00:00Z; the next
  // midnight 2026-03-30 00:00 (CEST) == 2026-03-29T22:00:00Z, i.e. 23 hours.
  assert.equal(
    secondsUntilNextTiranaDay(new Date("2026-03-28T23:00:00Z")),
    23 * 3600,
  );
  // Just before that shortened day's end.
  assert.equal(
    secondsUntilNextTiranaDay(new Date("2026-03-29T21:59:59Z")),
    1,
  );
});

test("secondsUntilNextTiranaDay handles the fall-back day as 25 hours", () => {
  // Europe/Tirane falls back on 2026-10-25 (03:00 CEST -> 02:00 CET).
  // Tirana midnight 2026-10-25 00:00 (CEST) == 2026-10-24T22:00:00Z; the next
  // midnight 2026-10-26 00:00 (CET) == 2026-10-25T23:00:00Z, i.e. 25 hours.
  assert.equal(
    secondsUntilNextTiranaDay(new Date("2026-10-24T22:00:00Z")),
    25 * 3600,
  );
});

test("secondsUntilNextTiranaDay rolls over across a month and year boundary", () => {
  // 2026-12-31 21:00 Tirana (CET); next midnight is 2027-01-01 00:00 CET.
  assert.equal(
    secondsUntilNextTiranaDay(new Date("2026-12-31T20:00:00Z")),
    3 * 3600,
  );
  assert.throws(() => secondsUntilNextTiranaDay(new Date("invalid")), RangeError);
});

test("sanitizeDailyResults returns an empty map for any non-object input", () => {
  assert.deepEqual(sanitizeDailyResults(null), {});
  assert.deepEqual(sanitizeDailyResults(undefined), {});
  assert.deepEqual(sanitizeDailyResults("2026-07-16"), {});
  assert.deepEqual(sanitizeDailyResults(42), {});
  assert.deepEqual(sanitizeDailyResults([["2026-07-16", 3]]), {});
});

test("sanitizeDailyResults keeps valid entries and drops invalid keys and values", () => {
  const raw = {
    "2026-07-16": 3,
    "2026-07-17": "X",
    "2026-07-18": 1,
    "2026-07-19": 6,
    "2026-7-20": 2, // malformed key
    "not-a-date": 4, // malformed key
    "2026-07-21": 0, // below range
    "2026-07-22": 7, // above range (maxGuesses = 6)
    "2026-07-23": 2.5, // not an integer
    "2026-07-24": "L", // not "X"
    "2026-07-25": null, // not a result
  };

  assert.deepEqual(sanitizeDailyResults(raw), {
    "2026-07-16": 3,
    "2026-07-17": "X",
    "2026-07-18": 1,
    "2026-07-19": 6,
  });
});

test("sanitizeDailyResults honors a custom maxGuesses bound", () => {
  const raw = { "2026-07-16": 4, "2026-07-17": 3 };
  assert.deepEqual(sanitizeDailyResults(raw, 3), { "2026-07-17": 3 });
});

test("createEmptyModeStats zero-fills every mode with a length-6 distribution", () => {
  const stats = createEmptyModeStats();
  assert.deepEqual(Object.keys(stats), [...MODE_STATS_KEYS]);
  for (const mode of MODE_STATS_KEYS) {
    assert.deepEqual(stats[mode], {
      played: 0,
      won: 0,
      distribution: [0, 0, 0, 0, 0, 0],
    });
  }
});

test("sanitizeModeStats zero-fills missing modes and non-object input", () => {
  assert.deepEqual(sanitizeModeStats(null), createEmptyModeStats());
  assert.deepEqual(sanitizeModeStats("nope"), createEmptyModeStats());
  assert.deepEqual(sanitizeModeStats([1, 2, 3]), createEmptyModeStats());
  assert.deepEqual(sanitizeModeStats({ daily: null }), createEmptyModeStats());
});

test("sanitizeModeStats keeps valid counts and repairs bad distributions", () => {
  const raw = {
    daily: { played: 5, won: 3, distribution: [0, 1, 2, 0, 0, 0] },
    archive: { played: 2, won: 2, distribution: "broken" },
    practice: { played: -4, won: 9.5, distribution: [1, 2] },
    challenge: { played: 1, won: 1, distribution: [1, 0, 0, 0, 0, 0, 99] },
  };
  const stats = sanitizeModeStats(raw);

  assert.deepEqual(stats.daily, {
    played: 5,
    won: 3,
    distribution: [0, 1, 2, 0, 0, 0],
  });
  // Non-array distribution zero-fills; length is always six.
  assert.deepEqual(stats.archive.distribution, [0, 0, 0, 0, 0, 0]);
  // Negative and non-integer counts drop to zero.
  assert.deepEqual(stats.practice, {
    played: 0,
    won: 0,
    distribution: [1, 2, 0, 0, 0, 0],
  });
  // A too-long distribution is truncated to six.
  assert.equal(stats.challenge.distribution.length, 6);
  assert.deepEqual(stats.challenge.distribution, [1, 0, 0, 0, 0, 0]);
});

test("sanitizeWordRatings drops invalid shapes and keeps valid entries", () => {
  assert.deepEqual(sanitizeWordRatings(null), {});
  assert.deepEqual(sanitizeWordRatings([["a", 1]]), {});

  const raw = {
    "daily-2026-07-16": { word: "anije", rating: "e_rralle", at: 1000 },
    "daily-2026-07-17": { word: "ardhje", rating: "not-a-rating", at: 1000 },
    "daily-2026-07-18": { word: "", rating: "e_drejte", at: 1000 },
    "daily-2026-07-19": { word: "dritë", rating: "e_drejte", at: 0 },
    "daily-2026-07-20": { word: "dritë", rating: "e_drejte", at: 2.5 },
    "daily-2026-07-21": "nope",
  };

  assert.deepEqual(sanitizeWordRatings(raw), {
    "daily-2026-07-16": { word: "anije", rating: "e_rralle", at: 1000 },
  });
  assert.ok(WORD_RATING_VALUES.includes("e_rralle"));
});

test("sanitizeWordRatings enforces the cap keeping the most recent by timestamp", () => {
  const raw = {};
  for (let index = 0; index < 10; index += 1) {
    raw[`daily-${index}`] = { word: "fjala", rating: "e_drejte", at: index + 1 };
  }
  const kept = sanitizeWordRatings(raw, 3);

  assert.equal(Object.keys(kept).length, 3);
  assert.deepEqual(
    new Set(Object.keys(kept)),
    new Set(["daily-9", "daily-8", "daily-7"]),
  );
});

test("sanitizeReportedWords trims, dedupes case-insensitively, and drops non-strings", () => {
  assert.deepEqual(sanitizeReportedWords(null), []);
  assert.deepEqual(
    sanitizeReportedWords(["  qeraj ", "QERAJ", 42, "", "  ", "dritë"]),
    ["qeraj", "dritë"],
  );
});

test("sanitizeReportedWords caps to the most recently appended words", () => {
  const raw = Array.from({ length: 250 }, (_, index) => `fjala${index}`);
  const capped = sanitizeReportedWords(raw, 200);

  assert.equal(capped.length, 200);
  assert.equal(capped[0], "fjala50");
  assert.equal(capped.at(-1), "fjala249");
});

test("applyCompletedGameToProfile records a daily win and advances a consecutive streak", () => {
  const original = createProfile();
  const result = applyCompletedGameToProfile(original, {
    puzzleId: "daily-2026-07-17",
    mode: "daily",
    status: "won",
    attemptCount: 2,
    answerTokens: ["gj", "y", "sh", "j", "a"],
    besa: true,
    usedHint: false,
  });

  assert.equal(result.recorded, true);
  assert.equal(result.profile.played, 11);
  assert.equal(result.profile.won, 8);
  assert.equal(result.profile.currentStreak, 4);
  assert.equal(result.profile.bestStreak, 5);
  assert.equal(result.profile.lastDailyWin, "2026-07-17");
  assert.equal(result.profile.dailyResults["2026-07-17"], 2);
  assert.deepEqual(result.profile.modeStats.daily, {
    played: 1,
    won: 1,
    distribution: [0, 1, 0, 0, 0, 0],
  });
  assert.equal(result.profile.besaWins, 3);
  assert.deepEqual(result.profile.collection, ["a", "n", "gj", "y", "sh", "j"]);
  assert.equal(original.played, 10);
  assert.equal(original.currentStreak, 3);
  assert.deepEqual(original.modeStats.daily.distribution, [0, 0, 0, 0, 0, 0]);
});

test("applyCompletedGameToProfile records a daily loss and resets only the daily streak", () => {
  const result = applyCompletedGameToProfile(createProfile(), {
    puzzleId: "daily-2026-07-17",
    mode: "daily",
    status: "lost",
    attemptCount: 6,
    answerTokens: [],
    besa: false,
    usedHint: false,
  });

  assert.equal(result.profile.played, 11);
  assert.equal(result.profile.won, 7);
  assert.equal(result.profile.currentStreak, 0);
  assert.equal(result.profile.bestStreak, 5);
  assert.equal(result.profile.lastDailyWin, "2026-07-16");
  assert.equal(result.profile.dailyResults["2026-07-17"], "X");
  assert.deepEqual(result.profile.modeStats.daily, {
    played: 1,
    won: 0,
    distribution: [0, 0, 0, 0, 0, 0],
  });
});

test("applyCompletedGameToProfile keeps archive, practice, and challenge outside the streak", () => {
  const cases = [
    ["archive", "archive-2026-07-15"],
    ["practice", "practice-SQ-ABC-1"],
    ["challenge", "challenge-SQ-ABC"],
  ];

  for (const [mode, puzzleId] of cases) {
    const result = applyCompletedGameToProfile(createProfile(), {
      puzzleId,
      mode,
      status: "won",
      attemptCount: 3,
      answerTokens: ["a", "n", "i", "j", "e"],
      besa: false,
      usedHint: false,
    });

    assert.equal(result.profile.currentStreak, 3, `${mode} must not alter the streak`);
    assert.equal(result.profile.bestStreak, 5, `${mode} must not alter best streak`);
    assert.equal(result.profile.lastDailyWin, "2026-07-16");
    assert.equal(result.profile.modeStats[mode].played, 1);
    assert.equal(result.profile.modeStats[mode].won, 1);
    assert.equal(result.profile.modeStats[mode].distribution[2], 1);
  }
});

test("applyCompletedGameToProfile records archive history without touching daily history semantics", () => {
  const result = applyCompletedGameToProfile(createProfile(), {
    puzzleId: "archive-2026-07-15",
    mode: "archive",
    status: "won",
    attemptCount: 5,
    answerTokens: ["d", "r", "i", "t", "ë"],
    besa: false,
    usedHint: false,
  });

  assert.equal(result.profile.dailyResults["2026-07-15"], 5);
  assert.equal(result.profile.dailyResults["2026-07-16"], 4);
  assert.equal(result.profile.currentStreak, 3);
});

test("applyCompletedGameToProfile records an assisted win in its paid-attempt bucket", () => {
  const result = applyCompletedGameToProfile(createProfile(), {
    puzzleId: "practice-SQ-HINT",
    mode: "practice",
    status: "won",
    attemptCount: 5,
    answerTokens: ["b", "u", "xh", "e", "t"],
    besa: true,
    usedHint: true,
  });

  assert.equal(result.profile.lastWinGuesses, 5);
  assert.equal(result.profile.distribution[4], 2);
  assert.equal(result.profile.modeStats.practice.distribution[4], 1);
  assert.equal(result.profile.besaWins, 2);
});

test("applyCompletedGameToProfile dedupes completed puzzles without mutating the profile", () => {
  const original = createProfile();
  const result = applyCompletedGameToProfile(original, {
    puzzleId: "daily-2026-07-16",
    mode: "daily",
    status: "won",
    attemptCount: 1,
    answerTokens: ["a", "n", "i", "j", "e"],
    besa: true,
    usedHint: false,
  });

  assert.equal(result.recorded, false);
  assert.equal(result.profile, original);
  assert.equal(original.played, 10);
  assert.equal(original.besaWins, 2);
});

test("applyCompletedGameToProfile enforces the completion cap and rejects invalid wins", () => {
  const capped = applyCompletedGameToProfile(
    createProfile({ completedPuzzles: ["a", "b", "c"] }),
    {
      puzzleId: "challenge-SQ-NEW",
      mode: "challenge",
      status: "lost",
      attemptCount: 6,
      answerTokens: [],
      besa: false,
      usedHint: false,
    },
    3,
  );
  assert.deepEqual(capped.profile.completedPuzzles, ["b", "c", "challenge-SQ-NEW"]);

  const defaultCapped = applyCompletedGameToProfile(
    createProfile({
      completedPuzzles: Array.from({ length: 4_000 }, (_, index) => `practice-${index}`),
    }),
    {
      puzzleId: "practice-NEW",
      mode: "practice",
      status: "lost",
      attemptCount: 6,
      answerTokens: [],
      besa: false,
      usedHint: false,
    },
  );
  assert.equal(defaultCapped.profile.completedPuzzles.length, 4_000);
  assert.equal(defaultCapped.profile.completedPuzzles[0], "practice-1");
  assert.equal(defaultCapped.profile.completedPuzzles.at(-1), "practice-NEW");

  assert.throws(
    () =>
      applyCompletedGameToProfile(createProfile(), {
        puzzleId: "daily-2026-07-17",
        mode: "daily",
        status: "won",
        attemptCount: 7,
        answerTokens: ["a"],
      }),
    RangeError,
  );
});

test("formatDuration clamps negatives, floors fractions, and adds hours when needed", () => {
  assert.equal(formatDuration(-2), "00:00");
  assert.equal(formatDuration(65.9), "01:05");
  assert.equal(formatDuration(3661), "1:01:01");
});

test("challenge codes round-trip, are case-insensitive, and reject invalid ranges", () => {
  for (const index of [0, 1, 35, 499]) {
    const code = createChallengeCode(index);
    assert.match(code, /^SQ-[0-9A-Z]+$/);
    assert.equal(decodeChallengeCode(code, 500), index);
    assert.equal(decodeChallengeCode(` ${code.toLowerCase()} `, 500), index);
  }

  assert.equal(decodeChallengeCode("not-a-code", 500), null);
  assert.equal(decodeChallengeCode("SQ-0", 500), null);
  assert.equal(decodeChallengeCode(createChallengeCode(500), 500), null);
  assert.throws(() => createChallengeCode(-1), RangeError);
});

// Daily-history fixture. Each pair was computed on this branch and must equal
// the word main's getDailyIndex(date, 62) produced for that date; the reviewer
// diffs against a full fixture generated on main, so any formula drift fails
// even though these pins are internally consistent. Noon UTC always resolves to
// the same Tirana calendar day, so the archive resolves the same words.
test("getDailyAnswerIndex reproduces the published daily history byte-for-byte", () => {
  const history = [
    ["2026-07-16", "bardhë"], // first published daily
    ["2026-07-17", "mësim"],
    ["2026-07-18", "dhjetë"],
    ["2026-08-01", "letër"],
    ["2026-09-15", "hapur"],
    ["2026-10-25", "ëndërr"], // Tirana DST fall-back day
    ["2026-12-31", "dëgjon"],
    ["2027-01-01", "xhiron"],
    ["2027-03-29", "thesar"], // Tirana DST spring-forward day
    ["2027-06-15", "fillim"],
    ["2027-09-01", "zemër"],
    ["2027-12-30", "këmbë"],
    ["2027-12-31", "cikli"], // last date in the pinned span
  ];

  for (const [dateKey, word] of history) {
    const date = new Date(`${dateKey}T12:00:00Z`);
    const index = getDailyAnswerIndex(date);
    assert.equal(getAnswerById(index).word, word, `${dateKey} must resolve to ${word}`);
    // The epoch resolver must match the raw pool-size formula while the launch
    // epoch is the only entry — this is the parity guarantee against main.
    assert.equal(index, getDailyIndex(date, 62), `${dateKey} epoch/raw parity`);
  }
});

// Growing the daily pool must never rewrite an already-published day. Appending
// a future epoch whose pool is the full 138-word catalog leaves every date in
// the launch epoch on the exact word it resolved to before.
test("appending a larger-pool epoch cannot rewrite earlier history", () => {
  const launchEpoch = DAILY_EPOCHS[0];
  const grown = [
    launchEpoch,
    Object.freeze({ start: "2027-01-01", poolSize: 138, stepBase: 37, offset: 911 }),
  ];

  const DAY = 86_400_000;
  const eraStart = Date.parse("2026-07-16T12:00:00Z");
  const eraEnd = Date.parse("2026-12-31T12:00:00Z"); // last day before epoch 2

  let checked = 0;
  for (let t = eraStart; t <= eraEnd; t += DAY) {
    const date = new Date(t);
    assert.equal(
      getDailyAnswerIndex(date, grown),
      getDailyAnswerIndex(date, [launchEpoch]),
      `${getTiranaDateKey(date)} must be unaffected by a later epoch`,
    );
    checked += 1;
  }
  assert.ok(checked >= 169, "expected a full launch-epoch span to be checked");

  // The appended epoch must genuinely engage its 138-word pool for later dates —
  // otherwise the safety proof above would be vacuous. An index >= 62 is only
  // reachable through the larger pool.
  let maxIndex = 0;
  for (let t = Date.parse("2027-01-01T12:00:00Z"); t <= Date.parse("2027-12-31T12:00:00Z"); t += DAY) {
    maxIndex = Math.max(maxIndex, getDailyAnswerIndex(new Date(t), grown));
  }
  assert.ok(maxIndex >= 62, "epoch 2 must reach words outside the 62-word launch pool");
});

// The epoch table is append-only and reviewed. Any change to this deepEqual —
// editing an epoch or inserting one out of order — must be a deliberate,
// reviewed append. Existing epochs are frozen; only new later-dated entries with
// their own (poolSize, stepBase, offset) may be added.
test("DAILY_EPOCHS is frozen, sorted, non-overlapping, and pinned", () => {
  assert.deepEqual(DAILY_EPOCHS, [
    { start: "2026-07-16", poolSize: 62, stepBase: 37, offset: 911 },
  ]);
  assert.ok(Object.isFrozen(DAILY_EPOCHS), "epoch table must be frozen");

  for (let i = 0; i < DAILY_EPOCHS.length; i += 1) {
    const epoch = DAILY_EPOCHS[i];
    assert.ok(Object.isFrozen(epoch), "each epoch must be frozen");
    assert.match(epoch.start, /^\d{4}-\d{2}-\d{2}$/, "epoch start must be an ISO date");
    assert.ok(Number.isInteger(epoch.poolSize) && epoch.poolSize > 0);
    assert.ok(Number.isInteger(epoch.stepBase) && epoch.stepBase > 0);
    assert.ok(Number.isInteger(epoch.offset) && epoch.offset >= 0);
    if (i > 0) {
      // Strictly ascending starts guarantee both sort order and non-overlap:
      // dailyEpochFor picks the last epoch whose start <= the date key.
      assert.ok(
        DAILY_EPOCHS[i - 1].start < epoch.start,
        "epochs must be strictly ascending by start date",
      );
    }
  }
});

// DAILY_POOL_SIZE in app.js is derived from this, so the pool size cannot drift
// from a second constant. The active epoch on a launch-era date is the launch
// epoch with its 62-word pool.
test("getActiveDailyEpoch returns the governing epoch for a date", () => {
  assert.equal(getActiveDailyEpoch(new Date("2026-07-18T12:00:00Z")).poolSize, 62);
  assert.equal(getActiveDailyEpoch(new Date("2026-07-16T12:00:00Z")), DAILY_EPOCHS[0]);
  // Dates before the first epoch clamp to it (preserving pre-epoch behavior).
  assert.equal(getActiveDailyEpoch(new Date("2000-01-01T12:00:00Z")), DAILY_EPOCHS[0]);
});

// The complete published daily mapping is locked by a golden fixture: every
// Tirana date from launch through 2030-12-31 must resolve to exactly the word
// recorded in tests/fixtures/daily-schedule.json. The 13-date pin above catches
// formula drift quickly; this catches ANY drift, including a fixture edit —
// regenerating via scripts/build-daily-fixture.mjs is only legitimate when a
// new epoch is appended, and the diff must touch no date before that epoch.
test("the full published daily schedule matches the golden fixture", async () => {
  const { readFile } = await import("node:fs/promises");
  const fixture = JSON.parse(
    await readFile(new URL("./fixtures/daily-schedule.json", import.meta.url), "utf8"),
  );
  const dates = Object.keys(fixture);

  assert.equal(dates[0], "2026-07-16", "fixture must start on launch day");
  assert.equal(dates.at(-1), "2030-12-31", "fixture must cover through 2030");
  assert.equal(dates.length, 1_630, "fixture must be gapless across the span");

  const drifted = [];
  for (const [dateKey, word] of Object.entries(fixture)) {
    const resolved = getAnswerById(getDailyAnswerIndex(new Date(`${dateKey}T12:00:00Z`))).word;
    if (resolved !== word) {
      drifted.push(`${dateKey}: fixture=${word} code=${resolved}`);
    }
  }
  assert.deepEqual(drifted, [], "published daily history must never move");
});
