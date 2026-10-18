import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  checkWordRunway,
  firstRepeatedDailyDate,
  nextAlreadyServedWord,
} from "../scripts/check-word-runway.mjs";
import { DAILY_EPOCHS } from "../src/game.js";

const SCRIPT = fileURLToPath(new URL("../scripts/check-word-runway.mjs", import.meta.url));

function runScript(today) {
  return spawnSync(process.execPath, [SCRIPT, "--today", today], { encoding: "utf8" });
}

test("the active 138-word pool starts over on 2026-12-08", () => {
  assert.equal(firstRepeatedDailyDate(), "2026-12-08");
});

// Expected values come from an independent brute force (a global first-served
// map over every date since launch, no epoch logic) and hand arithmetic:
// 92 distinct ids served 2026-07-16..10-18, so 138 - 92 = 46 never served.
test("launch-week words come back on 2026-11-08, before the pool starts over", () => {
  const today = new Date("2026-10-18T12:00:00Z");
  assert.deepEqual(nextAlreadyServedWord(today), {
    date: "2026-11-08",
    answerId: 4,
    firstServedOn: "2026-07-21",
    freshLeft: 46,
  });
});

test("51 days of pool runway is ok, and the output states both dates truthfully", () => {
  const result = checkWordRunway(new Date("2026-10-18T12:00:00Z"));
  assert.equal(result.level, "ok");
  assert.equal(result.daysLeft, 51);
  assert.match(result.message, /138-word daily pool starts over on 2026-12-08, in 51 days/u);
  assert.match(result.message, /already-served word: 2026-11-08 \(first served 2026-07-21\)/u);
  assert.match(result.message, /46 words never served/u);
  assert.match(result.message, /warn\/fail use the pool date/u);
  assert.doesNotMatch(result.message, /first repeated daily word/u);
  assert.match(result.message, /npm run editorial:epoch/u);
});

test("under 45 days warns without failing the check", () => {
  const result = checkWordRunway(new Date("2026-10-25T12:00:00Z"));
  assert.equal(result.level, "warn");
  assert.equal(result.daysLeft, 44);

  const run = runScript("2026-10-25");
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stderr, /^WARNING: .*2026-12-08/mu);
  assert.match(run.stderr, /npm run editorial:epoch/u);
});

test("under 14 days fails the check", () => {
  const result = checkWordRunway(new Date("2026-11-25T12:00:00Z"));
  assert.equal(result.level, "fail");
  assert.equal(result.daysLeft, 13);

  const run = runScript("2026-11-25");
  assert.equal(run.status, 1);
  assert.match(run.stderr, /^ERROR: .*2026-12-08/mu);
  assert.match(run.stderr, /npm run editorial:epoch/u);
});

test("a date past the first repeat fails", () => {
  assert.equal(checkWordRunway(new Date("2026-12-20T12:00:00Z")).level, "fail");
});

test("a later epoch restarts the pool count, but not the already-served history", () => {
  const ids = Object.freeze(Array.from({ length: 10 }, (_, id) => id));
  const epochs = [
    { start: "2026-07-16", poolSize: 62, stepBase: 37, offset: 911 },
    { start: "2026-08-01", answerIds: ids, poolSize: 10, stepBase: 37, offset: 911 },
  ];
  const today = new Date("2026-07-20T12:00:00Z");
  // A 10-word pool starts over on its 11th day...
  assert.equal(firstRepeatedDailyDate(today, epochs), "2026-08-11");
  // ...but ids 4 and 5 were served in launch week (07-21 and 07-16), so one of
  // the new pool's first ten days is a word players already saw.
  const served = nextAlreadyServedWord(today, epochs);
  assert.ok(served.date >= "2026-08-01" && served.date <= "2026-08-10", served.date);
});

test("an appended epoch (current ids + new ones) cannot hide repeats", () => {
  // What build-epoch-proposal.mjs produces: every current id, then the new ones.
  const answerIds = Object.freeze([...DAILY_EPOCHS[1].answerIds, 138, 139, 140, 141, 142, 143, 144, 145, 146, 147]);
  const epochs = [...DAILY_EPOCHS, { start: "2026-11-01", answerIds, poolSize: 148, stepBase: 37, offset: 911 }];
  const today = new Date("2026-10-18T12:00:00Z");
  const result = checkWordRunway(today, epochs);
  // The pool alone looks long: 2026-11-01 + 148 days.
  assert.equal(result.repeatDate, "2027-03-29");
  assert.equal(result.daysLeft, 162);
  // The truth for players: the new epoch's first day is already served (id 25,
  // 2026-10-06, per the brute force), and only 46 + 10 words are fresh.
  assert.deepEqual(nextAlreadyServedWord(today, epochs), {
    date: "2026-11-01",
    answerId: 25,
    firstServedOn: "2026-10-06",
    freshLeft: 56,
  });
  assert.match(result.message, /already-served word: 2026-11-01/u);
  assert.match(result.message, /56 words never served/u);
});
