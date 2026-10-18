import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  checkWordRunway,
  firstRepeatedDailyDate,
} from "../scripts/check-word-runway.mjs";

const SCRIPT = fileURLToPath(new URL("../scripts/check-word-runway.mjs", import.meta.url));

function runScript(today) {
  return spawnSync(process.execPath, [SCRIPT, "--today", today], { encoding: "utf8" });
}

test("the published epochs first repeat a daily word on 2026-12-08", () => {
  assert.equal(firstRepeatedDailyDate(), "2026-12-08");
});

test("51 days of runway is ok but still names the date and the next step", () => {
  const result = checkWordRunway(new Date("2026-10-18T12:00:00Z"));
  assert.equal(result.level, "ok");
  assert.equal(result.daysLeft, 51);
  assert.match(result.message, /2026-12-08/u);
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

test("a later epoch resets the repeat window", () => {
  const ids = Object.freeze(Array.from({ length: 10 }, (_, id) => id));
  const epochs = [
    { start: "2026-07-16", poolSize: 62, stepBase: 37, offset: 911 },
    { start: "2026-08-01", answerIds: ids, poolSize: 10, stepBase: 37, offset: 911 },
  ];
  assert.equal(firstRepeatedDailyDate(new Date("2026-07-20T12:00:00Z"), epochs), "2026-08-11");
});
