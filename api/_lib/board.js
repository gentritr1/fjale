// Rrethi board shaping and spoiler masking — PLAN-RRETHI-2026-08.md §2.4.
//
// This module is the spoiler guarantee. §2.4 requires masking to be decided
// server-side, never by client-side hiding, and the masked payload must OMIT
// the numeric keys rather than send `null` or `0` — a devtools reader must not
// be able to recover today's difficulty from a board they have not earned.
// Keeping that decision in one pure function (no HTTP, no database, no clock
// of its own) is what makes it testable before a single handler exists, and
// what stops each of the nine M1 endpoints from re-deriving the rule.
//
// The M1 handlers own transport, auth, and rate limiting. They own no masking.
//
// Deliberate omissions from every payload:
//   * member keys — the board identifies people by display name only. The
//     viewer's own row carries `you: true` so a client can highlight it
//     without the server ever emitting an identifier derived from a secret.
//   * `seconds` unless the circle opted in (§2.3, show_time defaults FALSE).
//     schema.sql accepts the column always and documents that stripping is the
//     handler's duty; this is where that duty is discharged.

import { getTiranaDateKey } from "../../src/game.js";
import { weeklyPoints } from "../../src/points.js";
import { assertDateKey, storeError } from "./store.js";

/**
 * Is `playDate` still spoilable for this viewer?
 *
 * Today AND yesterday are masked until the viewer posts their own result.
 * §2.4 as written masked today only, but the shipped archive keeps yesterday's
 * word playable one tap away, so revealing it spoils a game the viewer can
 * still play (2026-08-05 adversarial review, MAJOR 1). Yesterday is the right
 * boundary because §2.5's write window covers exactly today and yesterday: a
 * masked yesterday can always be unmasked by finishing, and it self-heals at
 * Tirana midnight when it ages out of the window. Older archive days stay
 * visible — they can never acquire a result row, so masking them would be
 * permanent, which is worse than the residual spoiler. Revisit if the write
 * window ever widens.
 *
 * The Tirana date comes from the shipped `getTiranaDateKey`, never a second
 * implementation: §2.4 is explicit that a duplicate date implementation is how
 * epochs drift, and that helper already handles DST.
 *
 * Fail-closed discipline: `now` and `viewerFinished` are the two inputs that
 * arm the guard, so both are validated hard — a null clock must throw, never
 * silently resolve to 1970 and unmask (`new Date(null)` is the epoch).
 *
 * @param {string} playDate       `YYYY-MM-DD`
 * @param {boolean} viewerFinished
 * @param {Date} [now]            injectable clock, for tests only
 * @returns {boolean}
 */
export function isBoardMasked(playDate, viewerFinished, now = new Date()) {
  assertDateKey(playDate, "playDate");
  if (typeof viewerFinished !== "boolean") {
    throw storeError("viewerFinished must be a boolean");
  }
  assertClock(now);
  if (viewerFinished) {
    return false;
  }
  const today = getTiranaDateKey(now);
  return playDate === today || playDate === previousDateKey(today);
}

/** @param {unknown} now */
function assertClock(now) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw storeError("now must be a valid Date");
  }
}

/** `YYYY-MM-DD` -> the previous calendar day, in pure UTC ordinal arithmetic. */
function previousDateKey(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day - 1);
  const paddedYear = String(date.getUTCFullYear()).padStart(4, "0");
  const paddedMonth = String(date.getUTCMonth() + 1).padStart(2, "0");
  const paddedDay = String(date.getUTCDate()).padStart(2, "0");
  return `${paddedYear}-${paddedMonth}-${paddedDay}`;
}

/**
 * One board row, already masked or already full.
 *
 * @typedef {object} BoardRow
 * @property {string} displayName
 * @property {boolean} finished
 * @property {true} [you]       present only on the viewer's own row
 * @property {number|"X"} [attempts]  full rows only; "X" is a loss
 * @property {boolean} [besa]        full rows only
 * @property {boolean} [hint]        full rows only
 * @property {number} [points]       full rows only
 * @property {number} [streak]       full rows only, when the caller supplies it
 * @property {number} [seconds]      full rows only, and only when showTime
 */

/**
 * Build the board for one circle on one day.
 *
 * Members with no result row still appear — §2.3's pre-finish board lists every
 * member with a `finished` boolean, which is why the store grew `listMembers`.
 *
 * @param {object} input
 * @param {Array<{memberKey:string, displayName:string}>} input.members roster, join order
 * @param {Array<import("./store.js").ResultRow>} input.results  rows for `playDate`
 * @param {string} input.viewerKey  the authenticated member's key
 * @param {string} input.playDate   `YYYY-MM-DD`
 * @param {boolean} [input.showTime] circle.show_time; gates `seconds`
 * @param {Record<string, number>} [input.streaks] memberKey -> streak, optional
 * @param {Date} [input.now]        injectable clock, for tests only
 * @returns {{playDate:string, masked:boolean, rows:BoardRow[]}}
 */
export function buildBoard(input) {
  if (input === null || typeof input !== "object") {
    throw storeError("buildBoard input must be an object");
  }
  const {
    members,
    results,
    viewerKey,
    playDate,
    showTime = false,
    streaks = {},
    now = new Date(),
  } = input;
  if (!Array.isArray(members) || !Array.isArray(results)) {
    throw storeError("members and results must be arrays");
  }
  if (typeof viewerKey !== "string" || viewerKey === "") {
    throw storeError("viewerKey must be a non-empty string");
  }
  if (streaks === null || typeof streaks !== "object" || Array.isArray(streaks)) {
    throw storeError("streaks must be a plain object");
  }
  assertDateKey(playDate, "playDate");
  assertClock(now);
  for (const member of members) {
    if (member === null || typeof member !== "object" || typeof member.memberKey !== "string") {
      throw storeError("every member must be an object with a memberKey");
    }
  }
  // Defense-in-depth: the M1 handler must 403 a non-member before ever calling
  // this, but a viewer outside the roster reaching here means that check was
  // bypassed — refuse rather than render.
  if (!members.some((member) => member.memberKey === viewerKey)) {
    throw storeError("viewerKey must be a member of the circle");
  }

  const resultByMember = new Map();
  for (const row of results) {
    // Defensive: a caller that passes another day's rows would silently
    // publish them under this date, which is exactly the leak this module
    // exists to prevent. This is deliberately a throw, not a filter — the
    // near-miss caller is one feeding listResultRange output straight in, and
    // filtering would quietly publish a different day's difficulty under this
    // date. The M1 week handler must group by day at the call site.
    if (row?.playDate !== playDate) {
      throw storeError("results must all belong to playDate");
    }
    resultByMember.set(row.memberKey, row);
  }

  const viewerFinished = resultByMember.has(viewerKey);
  const masked = isBoardMasked(playDate, viewerFinished, now);

  const rows = members.map((member) => {
    const result = resultByMember.get(member.memberKey);
    /** @type {BoardRow} */
    const row = {
      displayName: member.displayName,
      finished: Boolean(result),
    };
    if (member.memberKey === viewerKey) {
      row.you = true;
    }

    // The masked branch adds nothing else. Not a null, not a zero, not a
    // placeholder — the keys are simply absent from the JSON.
    if (masked || !result) {
      return row;
    }

    // One branch decides both the shown value and the score: anything that is
    // not an integer win 1..6 is a loss on the wire ("X", 0 points), so the
    // row and weeklyPoints can never disagree and a malformed store row can
    // never sort above a real win.
    const attempts =
      Number.isInteger(result.attempts) && result.attempts >= 1 && result.attempts <= 6
        ? result.attempts
        : "X";
    row.attempts = attempts;
    row.besa = result.besa;
    row.hint = result.hint;
    row.points = attempts === "X" ? 0 : weeklyPoints({ ...result, attempts });
    if (Object.hasOwn(streaks, member.memberKey) && typeof streaks[member.memberKey] === "number") {
      row.streak = streaks[member.memberKey];
    }
    // §2.3: time is a per-circle privacy opt-in, OFF by default — strict
    // boolean, so a truthy string can never switch it on.
    if (showTime === true && typeof result.seconds === "number") {
      row.seconds = result.seconds;
    }
    return row;
  });

  return { playDate, masked, rows: masked ? rows : sortFinishedFirst(rows) };
}

/**
 * Board order for a revealed day: best result first, losses after wins,
 * unfinished members last, ties broken by display name so the order is stable
 * and never depends on a member key the payload does not contain.
 *
 * A masked board is deliberately NOT sorted — ordering a masked board by score
 * would leak the ranking the mask exists to hide. It keeps roster order.
 */
function sortFinishedFirst(rows) {
  const rank = (row) => {
    if (!row.finished) return 3;
    return row.attempts === "X" ? 2 : 1;
  };
  return [...rows].sort((left, right) => {
    const byRank = rank(left) - rank(right);
    if (byRank !== 0) return byRank;
    if (rank(left) === 1 && left.attempts !== right.attempts) {
      return left.attempts - right.attempts;
    }
    return left.displayName.localeCompare(right.displayName, "sq-AL");
  });
}
