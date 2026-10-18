// Word-runway alarm, run as part of `npm run check`.
//
// The daily rotation is a finite pool: once the active epoch has used every
// answer id, the next day repeats a word. Adding words needs the owner's
// editorial review, so this warns early and fails only when the review can no
// longer land in time.
//
// Warning (exit 0): fewer than WARN_DAYS days before the first repeated word.
// Error (exit 1): fewer than FAIL_DAYS days, or the repeat already happened.
// `--today YYYY-MM-DD` pins the clock (used by tests).
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DAILY_EPOCHS,
  dateKeyFromOrdinal,
  dateKeyOrdinal,
  getActiveDailyEpoch,
  getDailyAnswerIndex,
  getTiranaDateKey,
} from "../src/game.js";

export const WARN_DAYS = 45;
export const FAIL_DAYS = 14;
const NEXT_STEP = "next step: review new answers, then `npm run editorial:epoch` to propose the next epoch";

function noonUtc(dateKey) {
  return new Date(`${dateKey}T12:00:00Z`);
}

// Walk forward from the epoch active on `today`; each epoch starts a fresh
// window, so only a repeat inside one epoch counts. The last epoch's pool is
// finite, so the loop always ends.
export function firstRepeatedDailyDate(today = new Date(), epochs = DAILY_EPOCHS) {
  let ordinal = dateKeyOrdinal(getActiveDailyEpoch(today, epochs).start);
  let epochStart = null;
  let seen = new Set();
  for (; ; ordinal += 1) {
    const date = noonUtc(dateKeyFromOrdinal(ordinal));
    const { start } = getActiveDailyEpoch(date, epochs);
    if (start !== epochStart) {
      epochStart = start;
      seen = new Set();
    }
    const answerId = getDailyAnswerIndex(date, epochs);
    if (seen.has(answerId)) {
      return dateKeyFromOrdinal(ordinal);
    }
    seen.add(answerId);
  }
}

export function checkWordRunway(today = new Date(), epochs = DAILY_EPOCHS) {
  const repeatDate = firstRepeatedDailyDate(today, epochs);
  const daysLeft = dateKeyOrdinal(repeatDate) - dateKeyOrdinal(getTiranaDateKey(today));
  const level = daysLeft < FAIL_DAYS ? "fail" : daysLeft < WARN_DAYS ? "warn" : "ok";
  const message =
    `Word runway: ${daysLeft} day${daysLeft === 1 ? "" : "s"} — the first repeated daily word ` +
    `is on ${repeatDate} (warn under ${WARN_DAYS}, fail under ${FAIL_DAYS}); ${NEXT_STEP}`;
  return { level, daysLeft, repeatDate, message };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const todayFlag = process.argv.indexOf("--today");
  const today = todayFlag === -1 ? new Date() : noonUtc(process.argv[todayFlag + 1]);
  const { level, message } = checkWordRunway(today);
  if (level === "fail") {
    console.error(`ERROR: ${message}`);
    process.exit(1);
  }
  if (level === "warn") {
    console.warn(`WARNING: ${message}`);
  } else {
    console.log(message);
  }
}
