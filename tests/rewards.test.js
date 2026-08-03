import test from "node:test";
import assert from "node:assert/strict";

import {
  ALBANIAN_ALPHABET,
  ALBANIAN_DIGRAPHS,
  applyCompletedGameToProfile,
  BADGE_IDS,
  computeEarnedBadges,
  dateKeyFromOrdinal,
  dateKeyOrdinal,
  getTiranaDateKey,
  isStreakGraceAvailable,
  MILESTONE_IDS,
  normalizeStreakForDate,
  sanitizeMilestones,
  sanitizeProfile,
  STREAK_GRACE_WINDOW_DAYS,
} from "../src/game.js";
import { DEFAULT_AVATAR_ID, DEFAULT_LETTER_SEAL } from "../src/avatars.js";
import { weeklyPoints } from "../src/points.js";

// Profiles are built through the real load path, so every test starts from the
// exact shape production persists.
function profile(overrides = {}) {
  return sanitizeProfile({
    played: 10,
    won: 10,
    currentStreak: 5,
    bestStreak: 5,
    lastDailyWin: "2026-08-01",
    lastWinGuesses: 3,
    besaWins: 0,
    distribution: [0, 0, 5, 3, 2, 0],
    collection: ["a", "n"],
    completedPuzzles: ["daily-2026-08-01"],
    dailyResults: { "2026-08-01": 3 },
    modeStats: {
      daily: { played: 10, won: 10, distribution: [0, 0, 5, 3, 2, 0] },
      archive: { played: 0, won: 0, distribution: [0, 0, 0, 0, 0, 0] },
      practice: { played: 0, won: 0, distribution: [0, 0, 0, 0, 0, 0] },
      challenge: { played: 0, won: 0, distribution: [0, 0, 0, 0, 0, 0] },
    },
    wordRatings: {},
    reportedWords: [],
    ...overrides,
  });
}

function complete(source, dateKey, overrides = {}) {
  return applyCompletedGameToProfile(
    source,
    {
      puzzleId: `daily-${dateKey}`,
      mode: "daily",
      status: "won",
      attemptCount: 3,
      answerTokens: ["a", "n", "i", "j", "e"],
      besa: false,
      usedHint: false,
      ...overrides,
    },
    undefined,
    { streakGraceEnabled: true },
  );
}

function normalizeWithGrace(source, dateKey) {
  return normalizeStreakForDate(source, dateKey, { streakGraceEnabled: true });
}

function modeStatsWith(overrides = {}) {
  const empty = { played: 0, won: 0, distribution: [0, 0, 0, 0, 0, 0] };
  return {
    daily: { ...empty, ...overrides.daily },
    archive: { ...empty, ...overrides.archive },
    practice: { ...empty, ...overrides.practice },
    challenge: { ...empty, ...overrides.challenge },
  };
}

function earned(source) {
  return new Set(
    computeEarnedBadges(source)
      .filter((badge) => badge.earned)
      .map((badge) => badge.id),
  );
}

// --- streak grace day -------------------------------------------------------

test("a one-day gap continues the streak without spending the grace day", () => {
  const result = complete(profile(), "2026-08-02");

  assert.equal(result.profile.currentStreak, 6);
  assert.equal(result.profile.bestStreak, 6);
  assert.equal(result.profile.lastGraceDate, null);
  assert.equal(result.events.streak.graceUsed, false);
  assert.equal(result.events.streak.continued, true);
  assert.equal(result.events.streak.broken, false);
  assert.deepEqual(
    { previous: result.events.streak.previous, current: result.events.streak.current },
    { previous: 5, current: 6 },
  );
});

test("streak grace is opt-in, so a dark reward flag cannot change live streaks", () => {
  const source = profile();
  const withoutGrace = applyCompletedGameToProfile(source, {
    puzzleId: "daily-2026-08-03",
    mode: "daily",
    status: "won",
    attemptCount: 3,
    answerTokens: ["a", "n", "i", "j", "e"],
    besa: false,
    usedHint: false,
  });

  assert.equal(withoutGrace.profile.currentStreak, 1);
  assert.equal(withoutGrace.profile.lastGraceDate, null);
  assert.equal(withoutGrace.events.streak.graceUsed, false);

  const normalized = normalizeStreakForDate(source, "2026-08-03");
  assert.equal(normalized.changed, true);
  assert.equal(normalized.profile.currentStreak, 0);
});

test("a two-day gap is forgiven once, recording the missed day", () => {
  const result = complete(profile(), "2026-08-03");

  assert.equal(result.profile.currentStreak, 6, "the streak survives one missed day");
  assert.equal(result.profile.bestStreak, 6);
  assert.equal(result.profile.lastGraceDate, "2026-08-02", "the missed day is recorded");
  assert.equal(result.events.streak.graceUsed, true);
  assert.equal(result.events.streak.continued, true);
  assert.equal(result.events.streak.broken, false);
});

test("a two-day gap breaks the streak when grace was spent inside the window", () => {
  const spentTenDaysAgo = complete(
    profile({ lastGraceDate: "2026-07-24" }),
    "2026-08-03",
  );

  assert.equal(spentTenDaysAgo.profile.currentStreak, 1, "the streak restarts");
  assert.equal(spentTenDaysAgo.profile.lastGraceDate, "2026-07-24", "no second grace is spent");
  assert.equal(spentTenDaysAgo.events.streak.graceUsed, false);
  assert.equal(spentTenDaysAgo.events.streak.broken, true);

  // Exactly 30 days back is still inside the rolling window.
  const spentThirtyDaysAgo = complete(
    profile({ lastGraceDate: "2026-07-04" }),
    "2026-08-03",
  );
  assert.equal(dateKeyOrdinal("2026-08-03") - dateKeyOrdinal("2026-07-04"), 30);
  assert.equal(spentThirtyDaysAgo.profile.currentStreak, 1);
  assert.equal(spentThirtyDaysAgo.profile.lastGraceDate, "2026-07-04");
});

test("grace becomes available again once the rolling window has passed", () => {
  const result = complete(profile({ lastGraceDate: "2026-07-03" }), "2026-08-03");

  assert.equal(dateKeyOrdinal("2026-08-03") - dateKeyOrdinal("2026-07-03"), 31);
  assert.equal(result.profile.currentStreak, 6);
  assert.equal(result.profile.lastGraceDate, "2026-08-02");
  assert.equal(result.events.streak.graceUsed, true);
  assert.equal(STREAK_GRACE_WINDOW_DAYS, 30);
});

test("two consecutive missed days break the streak regardless of grace", () => {
  const result = complete(profile(), "2026-08-04");

  assert.equal(dateKeyOrdinal("2026-08-04") - dateKeyOrdinal("2026-08-01"), 3);
  assert.equal(result.profile.currentStreak, 1);
  assert.equal(result.profile.lastGraceDate, null, "grace is never spent on a broken streak");
  assert.equal(result.events.streak.graceUsed, false);
  assert.equal(result.events.streak.broken, true);
});

test("grace is never stacked across two forgiven gaps in a row", () => {
  const first = complete(profile(), "2026-08-03");
  const second = complete(first.profile, "2026-08-05");

  assert.equal(first.profile.currentStreak, 6);
  assert.equal(second.profile.currentStreak, 1, "the second missed day is not forgiven");
  assert.equal(second.profile.lastGraceDate, "2026-08-02", "the first grace day still stands");
});

test("a played-and-lost day resets the streak and never spends the grace day", () => {
  const lost = complete(profile(), "2026-08-02", { status: "lost", attemptCount: 6 });

  assert.equal(lost.profile.currentStreak, 0);
  assert.equal(lost.profile.lastDailyWin, "2026-08-01", "a loss does not move the last win");
  assert.equal(lost.profile.lastGraceDate, null);
  assert.equal(lost.events.streak.broken, true);
  assert.equal(lost.events.streak.graceUsed, false);

  // The next day's win sits two days after the last WIN, but the day between
  // was played and lost — absence is forgiven, a loss is not.
  const recovered = complete(lost.profile, "2026-08-03");
  assert.equal(recovered.profile.currentStreak, 1);
  assert.equal(recovered.profile.lastGraceDate, null, "the grace day stays unspent");
  assert.equal(recovered.events.streak.graceUsed, false);
});

test("archive, practice, and challenge completions never touch streak or grace", () => {
  const cases = [
    ["archive", "archive-2026-08-02"],
    ["practice", "practice-SQ-ABC-1"],
    ["challenge", "challenge-SQ-ABC"],
  ];

  for (const [mode, puzzleId] of cases) {
    const result = applyCompletedGameToProfile(profile(), {
      puzzleId,
      mode,
      status: "won",
      attemptCount: 3,
      answerTokens: ["a", "n", "i", "j", "e"],
      besa: true,
      usedHint: false,
    });

    assert.equal(result.profile.currentStreak, 5, `${mode} must not alter the streak`);
    assert.equal(result.profile.lastGraceDate, null, `${mode} must not spend grace`);
    assert.equal(result.profile.besaDailyWins, 0, `${mode} must not count a daily Besa`);
    assert.equal(result.profile.besaWins, 1, `${mode} still counts the legacy Besa total`);
    assert.equal(result.events.streak.graceUsed, false);
    assert.equal(result.events.besaDaily, false);
  }
});

test("isStreakGraceAvailable reads the rolling window from the day being resolved", () => {
  assert.equal(isStreakGraceAvailable({ lastGraceDate: null }, "2026-08-03"), true);
  assert.equal(isStreakGraceAvailable({}, "2026-08-03"), true);
  assert.equal(isStreakGraceAvailable({ lastGraceDate: "2026-08-02" }, "2026-08-03"), false);
  assert.equal(isStreakGraceAvailable({ lastGraceDate: "2026-07-04" }, "2026-08-03"), false);
  assert.equal(isStreakGraceAvailable({ lastGraceDate: "2026-07-03" }, "2026-08-03"), true);
});

test("normalizeStreakForDate keeps a two-day gap alive only while grace remains", () => {
  const running = profile();

  assert.equal(normalizeWithGrace(running, "2026-08-02").changed, false);
  assert.equal(normalizeWithGrace(running, "2026-08-03").changed, false);
  assert.equal(
    normalizeWithGrace(running, "2026-08-03").profile.currentStreak,
    5,
    "a forgivable gap must not zero the streak before the day is played",
  );

  const spent = normalizeWithGrace(profile({ lastGraceDate: "2026-07-24" }), "2026-08-03");
  assert.equal(spent.changed, true);
  assert.equal(spent.profile.currentStreak, 0);

  const twoMissed = normalizeWithGrace(running, "2026-08-04");
  assert.equal(twoMissed.changed, true);
  assert.equal(twoMissed.profile.currentStreak, 0);
  assert.equal(running.currentStreak, 5, "the input profile is never mutated");

  assert.equal(normalizeWithGrace(profile({ currentStreak: 0 }), "2026-09-01").changed, false);
  assert.equal(normalizeWithGrace(profile({ lastDailyWin: null }), "2026-09-01").changed, false);
});

test("a streak kept alive by normalizeStreakForDate still spends grace when played", () => {
  const kept = normalizeWithGrace(profile(), "2026-08-03");
  const result = complete(kept.profile, "2026-08-03");

  assert.equal(result.profile.currentStreak, 6);
  assert.equal(result.profile.lastGraceDate, "2026-08-02");
});

test("a streak zeroed by normalizeStreakForDate restarts at one without spending grace", () => {
  const zeroed = normalizeWithGrace(profile({ lastGraceDate: "2026-07-24" }), "2026-08-03");
  const result = complete(zeroed.profile, "2026-08-03");

  assert.equal(result.profile.currentStreak, 1);
  assert.equal(result.profile.lastGraceDate, "2026-07-24");
});

// --- Tirana midnight boundary ----------------------------------------------

test("completions at 23:59 and 00:01 Tirana land on consecutive date keys", () => {
  // Europe/Tirane is UTC+2 in August and UTC+1 in December, so both sides of
  // the DST transition are covered by real instants rather than arithmetic.
  const boundaries = [
    ["2026-08-01T21:59:00Z", "2026-08-01T22:01:00Z", "2026-08-01", "2026-08-02"],
    ["2026-12-31T22:59:00Z", "2026-12-31T23:01:00Z", "2026-12-31", "2027-01-01"],
  ];

  for (const [beforeInstant, afterInstant, beforeKey, afterKey] of boundaries) {
    const before = getTiranaDateKey(new Date(beforeInstant));
    const after = getTiranaDateKey(new Date(afterInstant));

    assert.equal(before, beforeKey, `${beforeInstant} is still the previous Tirana day`);
    assert.equal(after, afterKey, `${afterInstant} has crossed Tirana midnight`);
    assert.equal(dateKeyOrdinal(after) - dateKeyOrdinal(before), 1);

    const start = profile({ lastDailyWin: before, completedPuzzles: [`daily-${before}`] });
    const crossed = complete(start, after);

    assert.equal(crossed.profile.currentStreak, 6, `${afterKey} must continue the streak`);
    assert.equal(crossed.profile.lastGraceDate, null, "a midnight crossing is not a missed day");
    assert.equal(crossed.profile.dailyResults[after], 3);
    assert.equal(normalizeWithGrace(start, after).changed, false);
  }
});

test("dateKeyFromOrdinal inverts dateKeyOrdinal across month and year ends", () => {
  for (const key of ["2026-08-02", "2026-03-01", "2027-01-01", "2026-12-31"]) {
    assert.equal(dateKeyFromOrdinal(dateKeyOrdinal(key)), key);
  }
  assert.equal(dateKeyFromOrdinal(dateKeyOrdinal("2027-01-01") - 1), "2026-12-31");
  assert.equal(dateKeyFromOrdinal(dateKeyOrdinal("2026-03-01") - 1), "2026-02-28");
  assert.equal(dateKeyFromOrdinal(dateKeyOrdinal("0099-01-01")), "0099-01-01");
  assert.throws(() => dateKeyOrdinal("2026-02-29"), RangeError);
  assert.throws(() => dateKeyOrdinal("2026-13-01"), RangeError);
  assert.throws(() => dateKeyOrdinal("0000-01-01"), RangeError);
  assert.throws(() => dateKeyFromOrdinal(Number.MAX_SAFE_INTEGER + 1), RangeError);
  assert.throws(() => dateKeyFromOrdinal(Number.MAX_SAFE_INTEGER), RangeError);
});

test("a two-day gap across the year boundary is forgiven with the right missed day", () => {
  const start = profile({
    lastDailyWin: "2026-12-31",
    completedPuzzles: ["daily-2026-12-31"],
  });
  const result = complete(start, "2027-01-02");

  assert.equal(result.profile.currentStreak, 6);
  assert.equal(result.profile.lastGraceDate, "2027-01-01");
});

// --- besaDailyWins ----------------------------------------------------------

test("a daily Besa win with no hint increments both Besa counters", () => {
  const result = complete(profile(), "2026-08-02", { besa: true, usedHint: false });

  assert.equal(result.profile.besaWins, 1);
  assert.equal(result.profile.besaDailyWins, 1);
  assert.equal(result.events.besaDaily, true);
});

test("a hinted or undeclared daily win increments neither Besa counter", () => {
  const hinted = complete(profile(), "2026-08-02", { besa: true, usedHint: true });
  const plain = complete(profile(), "2026-08-02", { besa: false, usedHint: false });

  assert.equal(hinted.profile.besaWins, 0);
  assert.equal(hinted.profile.besaDailyWins, 0);
  assert.equal(hinted.events.besaDaily, false);
  assert.equal(plain.profile.besaDailyWins, 0);
  assert.equal(plain.events.besaDaily, false);
});

// --- badges -----------------------------------------------------------------

test("computeEarnedBadges returns all eleven local badges in a stable order", () => {
  const badges = computeEarnedBadges(sanitizeProfile(null));

  assert.equal(badges.length, 11);
  assert.deepEqual(
    badges.map((badge) => badge.id),
    [...BADGE_IDS],
  );
  assert.ok(badges.every((badge) => badge.earned === false), "a fresh profile has earned none");
  assert.equal(new Set(BADGE_IDS).size, BADGE_IDS.length);
});

test("computeEarnedBadges returns concrete progress for every visible goal", () => {
  const badges = new Map(computeEarnedBadges(profile()).map((badge) => [badge.id, badge]));

  assert.deepEqual(
    badges.get("daily-fast-10"),
    { id: "daily-fast-10", current: 5, target: 10, earned: false },
  );
  assert.deepEqual(
    badges.get("streak-7"),
    { id: "streak-7", current: 5, target: 7, earned: false },
  );
  assert.deepEqual(
    badges.get("daily-win-1"),
    { id: "daily-win-1", current: 10, target: 1, earned: true },
  );
  assert.ok(
    [...badges.values()].every(
      ({ current, target }) =>
        Number.isInteger(current) && Number.isInteger(target) && current >= 0 && target > 0,
    ),
  );
});

test("each badge flips exactly at its boundary value", () => {
  const cases = [
    ["daily-win-1", { modeStats: modeStatsWith({ daily: { won: 0 } }) }, { modeStats: modeStatsWith({ daily: { won: 1 } }) }],
    [
      "daily-attempt-1",
      { modeStats: modeStatsWith({ daily: { distribution: [0, 9, 0, 0, 0, 0] } }) },
      { modeStats: modeStatsWith({ daily: { distribution: [1, 0, 0, 0, 0, 0] } }) },
    ],
    [
      "daily-attempt-6",
      { modeStats: modeStatsWith({ daily: { distribution: [0, 0, 0, 0, 9, 0] } }) },
      { modeStats: modeStatsWith({ daily: { distribution: [0, 0, 0, 0, 0, 1] } }) },
    ],
    [
      "daily-fast-10",
      { modeStats: modeStatsWith({ daily: { distribution: [3, 3, 3, 50, 0, 0] } }) },
      { modeStats: modeStatsWith({ daily: { distribution: [3, 3, 4, 0, 0, 0] } }) },
    ],
    ["streak-7", { bestStreak: 6 }, { bestStreak: 7 }],
    ["streak-30", { bestStreak: 29 }, { bestStreak: 30 }],
    [
      "daily-played-100",
      { modeStats: modeStatsWith({ daily: { played: 99 } }) },
      { modeStats: modeStatsWith({ daily: { played: 100 } }) },
    ],
    [
      "daily-win-25",
      { modeStats: modeStatsWith({ daily: { won: 24 } }) },
      { modeStats: modeStatsWith({ daily: { won: 25 } }) },
    ],
    [
      "digraphs-9",
      { collection: ALBANIAN_DIGRAPHS.slice(0, 8) },
      { collection: [...ALBANIAN_DIGRAPHS] },
    ],
    [
      "letters-36",
      { collection: ALBANIAN_ALPHABET.slice(0, 35) },
      { collection: [...ALBANIAN_ALPHABET] },
    ],
    ["daily-besa-3", { besaWins: 99, besaDailyWins: 2 }, { besaDailyWins: 3 }],
  ];

  for (const [id, below, atOrAbove] of cases) {
    const base = { currentStreak: 0, bestStreak: 0, collection: [], modeStats: modeStatsWith() };
    assert.equal(
      earned(sanitizeProfile({ ...base, ...below })).has(id),
      false,
      `${id} must not be earned one short of its threshold`,
    );
    assert.equal(
      earned(sanitizeProfile({ ...base, ...atOrAbove })).has(id),
      true,
      `${id} must be earned at its threshold`,
    );
  }
});

test("the Besa badge counts only daily Besa wins", () => {
  const practiceOnly = sanitizeProfile({ besaWins: 99, besaDailyWins: 0 });
  const daily = sanitizeProfile({ besaWins: 3, besaDailyWins: 3 });

  assert.ok(!earned(practiceOnly).has("daily-besa-3"));
  assert.ok(earned(daily).has("daily-besa-3"));
});

test("daily badges read modeStats, never the archive-contaminated dailyResults", () => {
  const dailyResults = Object.fromEntries(
    Array.from({ length: 120 }, (_, index) => [dateKeyFromOrdinal(20_000 + index), 1]),
  );
  const contaminated = sanitizeProfile({
    dailyResults,
    // Every one of those dates was played through the archive, so the daily
    // bucket is empty even though dailyResults is full (see completionDateKey).
    modeStats: modeStatsWith({ archive: { played: 120, won: 120, distribution: [120, 0, 0, 0, 0, 0] } }),
  });

  assert.equal(Object.keys(contaminated.dailyResults).length, 120);
  const badges = earned(contaminated);
  assert.ok(!badges.has("daily-win-1"));
  assert.ok(!badges.has("daily-attempt-1"));
  assert.ok(!badges.has("daily-played-100"));
  assert.ok(!badges.has("daily-win-25"), "archive wins cannot fill a Passport badge");
});

test("badges survive a broken streak", () => {
  const cooled = complete(profile({ bestStreak: 30, currentStreak: 30 }), "2026-09-30");

  assert.equal(cooled.profile.currentStreak, 1, "the streak restarted");
  assert.ok(earned(cooled.profile).has("streak-7"));
  assert.ok(earned(cooled.profile).has("streak-30"), "an earned badge is never taken away");
});

// --- milestones -------------------------------------------------------------

test("sanitizeMilestones keeps known ids once, in order", () => {
  assert.deepEqual(sanitizeMilestones(null), []);
  assert.deepEqual(sanitizeMilestones("streak-7"), []);
  assert.deepEqual(
    sanitizeMilestones(["streak-7", "streak-7", "nope", 7, "letters-36"]),
    ["streak-7", "letters-36"],
  );
  assert.deepEqual(sanitizeMilestones([...MILESTONE_IDS]).length, MILESTONE_IDS.length);
});

test("a newly crossed milestone is surfaced once and recorded forever", () => {
  const start = profile({
    currentStreak: 6,
    bestStreak: 6,
    milestones: [],
    lastDailyWin: "2026-08-01",
  });
  const crossed = complete(start, "2026-08-02");

  assert.equal(crossed.profile.currentStreak, 7);
  assert.deepEqual(crossed.events.newMilestones, ["streak-7"]);
  assert.deepEqual(crossed.profile.milestones, ["streak-7"]);

  // The same threshold on the following day must not fire or duplicate.
  const again = complete(crossed.profile, "2026-08-03");
  assert.deepEqual(again.events.newMilestones, []);
  assert.deepEqual(again.profile.milestones, ["streak-7"]);
});

test("milestones already satisfied are backfilled silently, never re-celebrated", () => {
  const legacy = profile({ currentStreak: 30, bestStreak: 30, milestones: [] });
  const result = complete(legacy, "2026-08-02");

  assert.deepEqual(
    result.events.newMilestones,
    [],
    "a legacy profile must not fire stale celebrations",
  );
  assert.deepEqual(result.profile.milestones, ["streak-7", "streak-30"]);
});

test("the first daily Besa win crosses the Besa milestone", () => {
  const result = complete(profile({ milestones: [] }), "2026-08-02", {
    besa: true,
    usedHint: false,
  });

  assert.deepEqual(result.events.newMilestones, ["besa-first"]);
  assert.equal(result.profile.besaDailyWins, 1);
});

test("only a daily win can fill the passport and cross collection milestones", () => {
  const oneShort = profile({ collection: ALBANIAN_ALPHABET.slice(0, 35), milestones: [] });
  const missing = ALBANIAN_ALPHABET[35];
  const practice = applyCompletedGameToProfile(oneShort, {
    puzzleId: "practice-SQ-ABC-1",
    mode: "practice",
    status: "won",
    attemptCount: 2,
    answerTokens: [missing, "a", "n", "i", "j"],
    besa: false,
    usedHint: false,
  });

  assert.deepEqual(practice.profile.collection, oneShort.collection);
  assert.deepEqual(practice.events.newLetters, []);
  assert.deepEqual(practice.events.newMilestones, []);

  const result = applyCompletedGameToProfile(practice.profile, {
    puzzleId: "daily-2026-08-02",
    mode: "daily",
    status: "won",
    attemptCount: 2,
    answerTokens: [missing, "a", "n", "i", "j"],
    besa: false,
    usedHint: false,
  });

  assert.deepEqual(result.events.newLetters, [missing]);
  assert.ok(result.events.newMilestones.includes("letters-36"));
  assert.ok(result.events.newMilestones.includes("digraphs-9"));
  assert.deepEqual(result.events.streak, {
    previous: 5,
    current: 6,
    changed: true,
    continued: true,
    graceUsed: false,
    broken: false,
  });
});

test("recording the same puzzle twice records nothing and fires nothing", () => {
  const first = complete(profile({ milestones: [] }), "2026-08-02", { besa: true });
  const replay = complete(first.profile, "2026-08-02", { besa: true });

  assert.equal(replay.recorded, false);
  assert.equal(replay.profile, first.profile, "a duplicate returns the profile untouched");
  assert.deepEqual(replay.events.newMilestones, []);
  assert.deepEqual(replay.events.newLetters, []);
  assert.equal(replay.events.besaDaily, false);
  assert.equal(replay.events.streak.changed, false);
});

test("the completion event reports new letters in collection order", () => {
  const result = complete(profile({ collection: ["a", "n"] }), "2026-08-02", {
    answerTokens: ["sh", "a", "n", "d", "ë"],
  });

  assert.deepEqual(result.events.newLetters, ["sh", "d", "ë"]);
  assert.deepEqual(result.profile.collection, ["a", "n", "sh", "d", "ë"]);
  assert.equal(result.events.mode, "daily");
  assert.equal(result.events.status, "won");
});

// --- weekly points ----------------------------------------------------------

test("weeklyPoints scores every win count from six down to one", () => {
  for (const [attempts, points] of [[1, 6], [2, 5], [3, 4], [4, 3], [5, 2], [6, 1]]) {
    assert.equal(weeklyPoints({ attempts, besa: false, hint: false }), points);
  }
});

test("weeklyPoints adds one point for a hint-free Besa win only", () => {
  assert.equal(weeklyPoints({ attempts: 3, besa: true, hint: false }), 5);
  assert.equal(weeklyPoints({ attempts: 3, besa: true, hint: true }), 4);
  assert.equal(weeklyPoints({ attempts: 3, besa: false, hint: true }), 4);
  assert.equal(weeklyPoints({ attempts: 1, besa: true, hint: false }), 7, "seven is the daily max");
});

test("weeklyPoints scores a loss, an unplayed day, and a malformed row as zero", () => {
  assert.equal(weeklyPoints({ attempts: "X", besa: true, hint: false }), 0);
  assert.equal(weeklyPoints({ attempts: null, besa: true, hint: false }), 0);
  assert.equal(weeklyPoints({ besa: true, hint: false }), 0);
  assert.equal(weeklyPoints({ attempts: 0 }), 0);
  assert.equal(weeklyPoints({ attempts: 7 }), 0);
  assert.equal(weeklyPoints({ attempts: 2.5 }), 0);
  assert.equal(weeklyPoints(undefined), 0);
  assert.equal(weeklyPoints(null), 0);
  assert.equal(weeklyPoints([]), 0);
  assert.equal(weeklyPoints("3"), 0);
});

// --- migration --------------------------------------------------------------

// The exact JSON the shipped build writes: saveProfile persists the object
// loadProfile returns, so this is the production shape field for field, with no
// besaDailyWins, no lastGraceDate, and no milestones.
function legacyProductionProfile() {
  return {
    played: 42,
    won: 37,
    currentStreak: 9,
    bestStreak: 14,
    lastDailyWin: "2026-07-31",
    lastWinGuesses: 4,
    besaWins: 5,
    distribution: [1, 6, 12, 10, 6, 2],
    collection: ["a", "n", "sh", "ë", "gj"],
    completedPuzzles: ["daily-2026-07-30", "daily-2026-07-31", "archive-2026-07-20"],
    dailyResults: { "2026-07-30": 3, "2026-07-31": 4, "2026-07-20": 5 },
    modeStats: {
      daily: { played: 30, won: 27, distribution: [1, 5, 10, 7, 3, 1] },
      archive: { played: 8, won: 7, distribution: [0, 1, 2, 2, 2, 0] },
      practice: { played: 3, won: 2, distribution: [0, 0, 0, 1, 1, 0] },
      challenge: { played: 1, won: 1, distribution: [0, 0, 0, 0, 0, 1] },
    },
    wordRatings: { "daily-2026-07-31": { word: "anije", rating: "e_drejte", at: 1_753_000_000_000 } },
    reportedWords: ["qeraj"],
  };
}

test("a legacy production profile loads with every total intact and new fields defaulted", () => {
  const legacy = legacyProductionProfile();
  const stored = JSON.parse(JSON.stringify(legacy));
  const loaded = sanitizeProfile(stored);

  for (const key of [
    "played",
    "won",
    "currentStreak",
    "bestStreak",
    "lastDailyWin",
    "lastWinGuesses",
    "besaWins",
  ]) {
    assert.deepEqual(loaded[key], legacy[key], `${key} must survive the migration`);
  }
  assert.deepEqual(loaded.distribution, legacy.distribution);
  assert.deepEqual(loaded.collection, legacy.collection);
  assert.deepEqual(loaded.completedPuzzles, legacy.completedPuzzles);
  assert.deepEqual(loaded.dailyResults, legacy.dailyResults);
  assert.deepEqual(loaded.modeStats, legacy.modeStats);
  assert.deepEqual(loaded.wordRatings, legacy.wordRatings);
  assert.deepEqual(loaded.reportedWords, legacy.reportedWords);

  // The five additive fields default rather than throw.
  assert.equal(loaded.besaDailyWins, 0);
  assert.equal(loaded.lastGraceDate, null);
  assert.deepEqual(loaded.milestones, []);
  assert.equal(loaded.avatarId, DEFAULT_AVATAR_ID);
  assert.equal(loaded.letterSeal, DEFAULT_LETTER_SEAL);
  assert.deepEqual(stored, legacy, "the stored JSON is never mutated");
});

test("a legacy profile keeps playing, earning, and persisting the new fields", () => {
  const loaded = sanitizeProfile(legacyProductionProfile());
  const result = complete(loaded, "2026-08-01", { besa: true, usedHint: false });
  const persisted = JSON.parse(JSON.stringify(result.profile));

  assert.equal(result.profile.currentStreak, 10, "the streak continues across the upgrade");
  assert.equal(result.profile.besaWins, 6, "the legacy Besa total keeps counting");
  assert.equal(result.profile.besaDailyWins, 1);
  assert.deepEqual(result.events.newMilestones, ["besa-first"]);
  assert.deepEqual(result.profile.milestones, ["streak-7", "besa-first"]);
  assert.deepEqual(sanitizeProfile(persisted), result.profile, "the new fields round-trip");
});

test("a captured real production profile loads intact and keeps its earned badge state", async () => {
  // Captured from localStorage (fjale:profile:v1) after playing the 2026-08-01
  // daily to a Besa win on the shipped build at commit 1de4ae0 — a genuine
  // production write, not a hand-built shape.
  const { readFile } = await import("node:fs/promises");
  const raw = await readFile(
    new URL("./fixtures/profile-production-2026-08-01.json", import.meta.url),
    "utf8",
  );
  const captured = JSON.parse(raw);
  const loaded = sanitizeProfile(captured);

  assert.deepEqual(
    {
      ...loaded,
      besaDailyWins: undefined,
      lastGraceDate: undefined,
      milestones: undefined,
      avatarId: undefined,
      letterSeal: undefined,
    },
    {
      ...captured,
      besaDailyWins: undefined,
      lastGraceDate: undefined,
      milestones: undefined,
      avatarId: undefined,
      letterSeal: undefined,
    },
    "every captured field survives the load path unchanged",
  );
  assert.equal(loaded.besaDailyWins, 0);
  assert.equal(loaded.lastGraceDate, null);
  assert.deepEqual(loaded.milestones, []);
  assert.equal(loaded.avatarId, DEFAULT_AVATAR_ID);
  assert.equal(loaded.letterSeal, DEFAULT_LETTER_SEAL);

  const badges = new Map(computeEarnedBadges(loaded).map((b) => [b.id, b.earned]));
  assert.equal(badges.get("daily-win-1"), true, "first daily win badge from the captured win");
  assert.equal(badges.get("daily-attempt-1"), true, "won in one attempt on the captured day");
  assert.equal(badges.get("daily-besa-3"), false, "one Besa win does not reach the badge");
});

test("a corrupt or absent profile still loads a complete, zeroed shape", () => {
  for (const input of [null, undefined, "nope", [], 7, { collection: "x", milestones: "streak-7" }]) {
    const loaded = sanitizeProfile(input);

    assert.equal(loaded.played, 0);
    assert.equal(loaded.besaDailyWins, 0);
    assert.equal(loaded.lastGraceDate, null);
    assert.deepEqual(loaded.milestones, []);
    assert.equal(loaded.avatarId, DEFAULT_AVATAR_ID);
    assert.equal(loaded.letterSeal, DEFAULT_LETTER_SEAL);
    assert.deepEqual(loaded.collection, []);
    assert.equal(loaded.distribution.length, 6);
    assert.equal(Object.keys(loaded.modeStats).length, 4);
  }

  assert.equal(sanitizeProfile({ lastGraceDate: "2026-8-2" }).lastGraceDate, null);
  assert.equal(sanitizeProfile({ lastGraceDate: "2026-02-29" }).lastGraceDate, null);
  assert.equal(sanitizeProfile({ lastGraceDate: "0000-01-01" }).lastGraceDate, null);
  assert.equal(sanitizeProfile({ lastDailyWin: "2026-04-31" }).lastDailyWin, null);
  assert.equal(sanitizeProfile({ lastGraceDate: "2026-08-02" }).lastGraceDate, "2026-08-02");
  assert.equal(sanitizeProfile({ played: Number.MAX_SAFE_INTEGER + 1 }).played, 0);
  assert.deepEqual(
    sanitizeProfile({ completedPuzzles: ["", "x".repeat(101), "daily-2026-08-02"] })
      .completedPuzzles,
    ["daily-2026-08-02"],
  );
});
