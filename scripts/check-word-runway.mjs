// Word-runway alarm, run as part of `npm run check`.
//
// Two different facts, both printed:
//
// 1. Pool date: the active epoch's pool is finite, so once it has used every
//    answer id it starts over. Adding words needs the owner's editorial review,
//    so the warn/fail thresholds use this date.
// 2. Already-served date: an epoch may re-include ids earlier epochs served
//    (build-epoch-proposal.mjs keeps every current id), so a player can see an
//    old word long before the pool starts over. This is counted over all
//    history since launch, with the number of never-served words left. It is
//    information only: after any normal append it is near-immediate, and
//    failing on it would keep CI red for good.
//
// Warning (exit 0): fewer than WARN_DAYS days before the pool starts over.
// Error (exit 1): fewer than FAIL_DAYS days, or it already started over.
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

// Walk every date since launch: the first date on or after `today` whose word
// was already served on an earlier date, and how many ids in the pools still
// to come (the active epoch and later ones) were never served through today.
export function nextAlreadyServedWord(today = new Date(), epochs = DAILY_EPOCHS) {
  const todayKey = getTiranaDateKey(today);
  const firstServed = new Map();
  for (let ordinal = dateKeyOrdinal(epochs[0].start); ; ordinal += 1) {
    const key = dateKeyFromOrdinal(ordinal);
    const answerId = getDailyAnswerIndex(noonUtc(key), epochs);
    if (key >= todayKey && firstServed.has(answerId)) {
      const activeStart = getActiveDailyEpoch(today, epochs).start;
      const upcoming = new Set(
        epochs
          .filter((epoch) => epoch.start >= activeStart)
          .flatMap((epoch) => epoch.answerIds ?? Array.from({ length: epoch.poolSize }, (_, id) => id)),
      );
      const servedByToday = [...firstServed].filter(([, date]) => date <= todayKey).map(([id]) => id);
      const freshLeft = [...upcoming].filter((id) => !servedByToday.includes(id)).length;
      return { date: key, answerId, firstServedOn: firstServed.get(answerId), freshLeft };
    }
    if (!firstServed.has(answerId)) firstServed.set(answerId, key);
  }
}

export function checkWordRunway(today = new Date(), epochs = DAILY_EPOCHS) {
  const repeatDate = firstRepeatedDailyDate(today, epochs);
  const daysLeft = dateKeyOrdinal(repeatDate) - dateKeyOrdinal(getTiranaDateKey(today));
  const level = daysLeft < FAIL_DAYS ? "fail" : daysLeft < WARN_DAYS ? "warn" : "ok";
  const served = nextAlreadyServedWord(today, epochs);
  const { poolSize } = getActiveDailyEpoch(noonUtc(dateKeyFromOrdinal(dateKeyOrdinal(repeatDate) - 1)), epochs);
  const message =
    `Word runway: the ${poolSize}-word daily pool ${daysLeft < 0 ? "started" : "starts"} over on ${repeatDate}, ` +
    `${daysLeft < 0 ? `${-daysLeft} days ago` : `in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`} ` +
    `(warn/fail use the pool date: warn under ${WARN_DAYS}, fail under ${FAIL_DAYS}).\n` +
    `  Next already-served word: ${served.date} (first served ${served.firstServedOn}); ` +
    `${served.freshLeft} words never served yet remain in the current and scheduled pools.\n` +
    `  ${NEXT_STEP}`;
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
