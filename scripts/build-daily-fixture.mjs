// Regenerates tests/fixtures/daily-schedule.json: the complete published
// daily mapping (Tirana date -> answer word) for 2026-07-16 .. 2030-12-31.
//
// The fixture is a REVIEW artifact, not a build input: the test recomputes the
// schedule from src/game.js and fails on any byte difference. Running this
// script is only legitimate when a new epoch is deliberately appended — the
// diff must then show ONLY dates on or after the new epoch's start. A diff
// touching any earlier date means published history moved, which is forbidden
// (see DAILY_EPOCHS in src/game.js).
import { writeFile } from "node:fs/promises";
import { getDailyAnswerIndex, getTiranaDateKey } from "../src/game.js";
import { getAnswerById } from "../src/words.js";

export const FIXTURE_START = "2026-07-16";
export const FIXTURE_END = "2030-12-31";

export function buildDailySchedule() {
  const DAY = 86_400_000;
  const schedule = {};
  for (
    let t = Date.parse(`${FIXTURE_START}T12:00:00Z`);
    t <= Date.parse(`${FIXTURE_END}T12:00:00Z`);
    t += DAY
  ) {
    const date = new Date(t);
    schedule[getTiranaDateKey(date)] = getAnswerById(getDailyAnswerIndex(date)).word;
  }
  return schedule;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const schedule = buildDailySchedule();
  const target = new URL("../tests/fixtures/daily-schedule.json", import.meta.url);
  await writeFile(target, `${JSON.stringify(schedule, null, 2)}\n`);
  console.log(
    `Wrote ${Object.keys(schedule).length} days (${FIXTURE_START}..${FIXTURE_END}) to tests/fixtures/daily-schedule.json`,
  );
}
