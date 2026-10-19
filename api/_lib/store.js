// Rrethi storage boundary — PLAN-RRETHI-2026-08.md §2.9.
//
// Milestone M0 is storage only: this module defines the interface, the shared
// input validation, and the adapter factory. There are no HTTP handlers, no
// auth, no rate-limit *policy* (only the `takeToken` primitive), and no
// masking — those are M1. Nothing here is imported by the client bundle.
//
// The three rules that make the adapter swap real rather than aspirational
// (plan §2.9), enforced by `tests/rrethi-store.test.js` against every adapter:
//
//   1. `putResult` returns a discriminated `'created' | 'conflict'` and never
//      throws a driver error. Insert-if-absent is the adapter's job; a handler
//      must never see a Postgres SQLSTATE.
//   2. No driver types cross this boundary. Calendar dates are `YYYY-MM-DD`
//      strings and never `Date` objects; timestamps are ISO-8601 UTC strings
//      (`YYYY-MM-DDTHH:MM:SS.mmmZ`); every error thrown out of an adapter is a
//      plain `Error` whose message starts with `rrethi: ` (the original driver
//      error, when there is one, is attached as `cause` for logs only).
//   3. Both adapters are held to one conformance suite. Where the plan's SQL
//      (§2.8) defines behaviour — cascades above all — the memory adapter
//      mirrors the SQL rather than inventing convenient semantics.
//
// Rows are returned as fresh plain objects: mutating a returned row never
// mutates stored state in any adapter.

/**
 * A player. `memberKey` is `HMAC-SHA-256(server_pepper, secret)` (plan §2.2); the
 * raw secret is never stored and never reaches this layer.
 *
 * `avatarId` and `letterSeal` are the profile the client already keeps locally
 * (`src/avatars.js`) and M1 transmits (plan §2.1.1). Both are `NOT NULL DEFAULT`
 * columns, so they are always strings and never null.
 *
 * @typedef {object} Member
 * @property {string} memberKey
 * @property {string} displayName
 * @property {string} avatarId
 * @property {string} letterSeal
 * @property {string} createdAt   ISO-8601 UTC, e.g. `2026-08-01T21:04:05.123Z`
 * @property {string} lastSeenAt  ISO-8601 UTC
 */

/**
 * A circle. `showTime` is the per-circle opt-in of plan §2.3; it stays FALSE
 * until M1 exposes a toggle.
 *
 * @typedef {object} Circle
 * @property {string} code
 * @property {string} name
 * @property {string} ownerKey
 * @property {boolean} showTime
 * @property {string} createdAt   ISO-8601 UTC
 */

/**
 * One day's self-reported summary (plan §2.5: no grid, no guesses, no answer).
 *
 * @typedef {object} ResultInput
 * @property {string} circleCode
 * @property {string} memberKey
 * @property {string} playDate    `YYYY-MM-DD`, Tirana calendar date
 * @property {?number} attempts   1..6, or `null` for a loss
 * @property {boolean} besa
 * @property {boolean} hint
 * @property {?number} [seconds]  non-negative integer, or `null`
 */

/**
 * @typedef {object} ResultRow
 * @property {string} circleCode
 * @property {string} memberKey
 * @property {string} playDate    `YYYY-MM-DD`
 * @property {?number} attempts   1..6, or `null` for a loss
 * @property {boolean} besa
 * @property {boolean} hint
 * @property {?number} seconds
 * @property {string} createdAt   ISO-8601 UTC
 */

/**
 * The storage interface. Reproduced from plan §2.9, plus `listMembers` — see
 * "Deviation" below.
 *
 * Semantics every adapter must share (the conformance suite is the referee):
 *
 * - `createMember` / `createCircle` / `addMembership` are insert-if-absent
 *   and never overwrite. `createCircle` and `addMembership` return
 *   `'created' | 'conflict'` (same discriminated shape as `putResult`) so a
 *   caller can detect a collision atomically — read-then-insert is a TOCTOU
 *   race over the non-interactive HTTP driver and must never be the answer.
 *   M1's circle-code generator retries on `'conflict'`. `createMember` stays
 *   `void`: an existing member re-registering is the intended no-op, not a
 *   collision anyone needs to observe.
 * - `renameMember` on an unknown key is a no-op, not an error.
 * - `deleteMember` cascades exactly as §2.8's SQL does: memberships, the
 *   results reachable through them, and the circles the member owns (which in
 *   turn cascade their memberships and results).
 * - `removeMembership` cascades that member's results *in that circle only*.
 * - `putResult` is first-write-wins and the stored row is immutable: a second
 *   call for the same `(circleCode, memberKey, playDate)` returns `'conflict'`
 *   and changes nothing (plan §2.5, §2.12 M0 acceptance).
 * - Writing a result for a non-member throws (referential integrity); this is
 *   the one `putResult` failure that is *not* a driver error and so is allowed
 *   to throw rather than return a discriminated value.
 * - `listResults` orders by `attempts` ascending with losses (`null`) last,
 *   then `memberKey`, which is the board order of plan §2.3 minus the ranking
 *   (ties and rank numbers are M1 presentation). `listResultRange` orders by
 *   `playDate`, then `memberKey`. Both ranges are inclusive.
 * - `takeToken` is a fixed window: it allows `limit` calls per `windowMs`
 *   per `bucket` and returns `false` after that until the window rolls over.
 *   It is a primitive only — which buckets exist and what the limits are is
 *   M1 policy (plan §2.5). Honesty note for serverless: the memory adapter's
 *   window lives in one process, so on Vercel the effective limit is
 *   `limit × concurrent instances` and resets on every cold start — treat it
 *   as best-effort. Only the Neon adapter's counter is global, and each check
 *   there costs a database write, so reserve DB-backed buckets for the
 *   operations genuinely worth a round trip (create/join), not cheap reads.
 *
 * The three methods M1 adds (recorded as deviation D3 in PLAN-RRETHI-M1-API.md
 * §12; all additive, so the M0 conformance suite runs unmodified):
 *
 * - `claimSeat` is the atomic join §2.5 demands. A handler-side count followed
 *   by `addMembership` is forbidden — it is a TOCTOU race over a
 *   non-interactive HTTP driver, and two concurrent joins would seat an
 *   eleventh member. The seat number is the mechanism: `UNIQUE (circle_code,
 *   seat)` refuses the eleventh seat in the database, not in the handler.
 *   Expected outcomes are discriminated values, never exceptions — including
 *   `'missing'`, because a mistyped invite code is an ordinary `404` rather
 *   than an error path. Seats are an internal mechanism and are never returned
 *   in any payload.
 * - `upsertMember` exists because `POST /members` is both registration and
 *   profile edit and there is no `PATCH` among the nine endpoints.
 *   `createMember` is documented above as an intentional no-op for an existing
 *   member, so it cannot serve the edit; rather than change its contract, M1
 *   adds an upsert that covers both and reports which happened. `createMember`
 *   and `renameMember` stay as the narrow primitives the conformance suite uses.
 * - `touchMember` closes the `last_seen_at` gap recorded below. It is a no-op
 *   on an unknown key, matching `renameMember`.
 *
 * @typedef {object} RrethiStore
 * @property {(key:string, name:string) => Promise<void>}                createMember
 * @property {(key:string) => Promise<?Member>}                          getMember
 * @property {(key:string, name:string) => Promise<void>}                renameMember
 * @property {(key:string, profile:{displayName:string, avatarId:string, letterSeal:string}) => Promise<'created'|'updated'>} upsertMember
 * @property {(key:string) => Promise<void>}                             touchMember
 * @property {(key:string) => Promise<void>}                             deleteMember
 * @property {(code:string, name:string, owner:string) => Promise<'created'|'conflict'>} createCircle
 * @property {(code:string) => Promise<?Circle>}                         getCircle
 * @property {(code:string, key:string) => Promise<'created'|'conflict'>} addMembership
 * @property {(code:string, key:string, maxSeats:number, maxCircles:number) => Promise<'created'|'conflict'|'full'|'missing'|'over_circle_limit'>} claimSeat
 * @property {(code:string, key:string) => Promise<void>}                removeMembership
 * @property {(key:string) => Promise<Circle[]>}                         listCirclesFor
 * @property {(code:string) => Promise<Member[]>}                        listMembers
 * @property {(r:ResultInput) => Promise<'created'|'conflict'>}          putResult
 * @property {(code:string, date:string) => Promise<ResultRow[]>}        listResults
 * @property {(code:string, from:string, to:string) => Promise<ResultRow[]>} listResultRange
 * @property {(bucket:string, limit:number, windowMs:number) => Promise<boolean>} takeToken
 */

// Deviation from plan §2.9, recorded deliberately:
//
//   `listMembers(code)` is added as a fourteenth method. The plan's typedef
//   lists thirteen and has no way to read a circle's roster, but §2.4 requires
//   the masked board to list every member with a `finished` boolean — including
//   members who have no result row yet, who are therefore invisible to
//   `listResults`. Without it M1 cannot render the pre-finish board at all.
//   It is additive: no listed method changed shape.
//
// Known M0 gap, closed by M1's `touchMember`: nothing updated
// `member.last_seen_at` after `createMember`. The plan's interface has no touch
// method and M0 had no request path to call one from.

import { DEFAULT_AVATAR_ID, DEFAULT_LETTER_SEAL } from "../../src/avatars.js";

/**
 * Both caps of plan §2.5. They are arguments to `claimSeat` rather than adapter
 * constants so the conformance suite can drive smaller circles, but these are
 * the only values a handler may pass: `schema.sql`'s
 * `CHECK (seat BETWEEN 1 AND 10)` hard-codes the ceiling, so an adapter refuses
 * a larger `maxSeats` rather than letting it surface as a constraint violation.
 */
export const CIRCLE_MAX_MEMBERS = 10;
export const MEMBER_MAX_CIRCLES = 10;

/**
 * The profile columns' defaults, imported from the client catalog rather than
 * re-typed, so `schema.sql`'s `DEFAULT` literals and the memory adapter can
 * never drift from `src/avatars.js`. `tests/rrethi-store.test.js` asserts that
 * `schema.sql` still spells exactly these two values.
 */
export const DEFAULT_PROFILE = Object.freeze({
  avatarId: DEFAULT_AVATAR_ID,
  letterSeal: DEFAULT_LETTER_SEAL,
});

/** Calendar dates cross this boundary as strings, never as `Date`. */
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

/** Attempts are 1..6, or `null` for a loss (plan §2.5 shape rule). */
export const ATTEMPTS_MIN = 1;
export const ATTEMPTS_MAX = 6;

/** Postgres `INTEGER` upper bound; keeps memory and Neon behavior identical. */
export const SECONDS_MAX = 2_147_483_647;

// Storage accepts already-normalized domain strings from the future HTTP
// handlers, but it still rejects inputs that can collide in the memory
// adapter's NUL-delimited composite keys or consume unbounded memory.
const STORAGE_TEXT_MAX_LENGTH = 256;

/**
 * Exported additively for the M1 HTTP layer, which applies the same rule to
 * `displayName` and circle `name` before storage ever sees them. One pattern,
 * so the transport and storage rejections can never disagree about what counts
 * as a control character.
 */
export const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;

/**
 * Every error an adapter throws is a plain `Error` from this helper, so no
 * driver error class ever escapes. Driver detail rides along as `cause`.
 *
 * @param {string} message
 * @param {unknown} [cause]
 * @returns {Error}
 */
export function storeError(message, cause) {
  return cause === undefined
    ? new Error(`rrethi: ${message}`)
    : new Error(`rrethi: ${message}`, { cause });
}

/**
 * The single message both adapters use when a write has no row to hang off:
 * Postgres raises SQLSTATE 23503, the memory adapter checks its maps, and the
 * conformance suite asserts one regex against both.
 */
export const FOREIGN_KEY_MESSAGE =
  "write violates a foreign key (missing circle, member, or membership)";

/** @param {unknown} [cause] */
export function foreignKeyError(cause) {
  return storeError(FOREIGN_KEY_MESSAGE, cause);
}

/**
 * @param {unknown} value
 * @param {string} label
 * @returns {string}
 */
export function assertKey(value, label) {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.length > STORAGE_TEXT_MAX_LENGTH ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    throw storeError(
      `${label} must be a non-empty string up to ${STORAGE_TEXT_MAX_LENGTH} characters without control characters`,
    );
  }
  return value;
}

/**
 * @param {unknown} value
 * @param {string} label
 * @returns {string}
 */
export function assertDateKey(value, label) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) {
    throw storeError(`${label} must be a real YYYY-MM-DD calendar date, not a Date`);
  }

  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || year > 9999) {
    throw storeError(`${label} must be a real YYYY-MM-DD calendar date, not a Date`);
  }
  const candidate = new Date(0);
  candidate.setUTCHours(0, 0, 0, 0);
  candidate.setUTCFullYear(year, month - 1, day);
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    throw storeError(`${label} must be a real YYYY-MM-DD calendar date, not a Date`);
  }
  return value;
}

/**
 * Widest inclusive range `listResultRange` accepts. Every real board query is a
 * week; a leap year is the generous ceiling. Without a cap, one crafted request
 * ("0001-01-01".."9999-12-31") is a full-table scan billed in Neon
 * compute-seconds on an endpoint that will face the public internet in M1.
 */
export const DATE_RANGE_MAX_DAYS = 366;

/** @param {string} key A validated YYYY-MM-DD key. */
function dateKeyToUtcDays(key) {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return Math.floor(date.getTime() / 86_400_000);
}

/**
 * Validates an inclusive calendar range once for both storage adapters.
 *
 * @param {unknown} from
 * @param {unknown} to
 * @returns {{from:string, to:string}}
 */
export function assertDateRange(from, to) {
  const normalizedFrom = assertDateKey(from, "from");
  const normalizedTo = assertDateKey(to, "to");
  if (normalizedFrom > normalizedTo) {
    throw storeError("from must be on or before to");
  }
  if (dateKeyToUtcDays(normalizedTo) - dateKeyToUtcDays(normalizedFrom) >= DATE_RANGE_MAX_DAYS) {
    throw storeError(`range must span at most ${DATE_RANGE_MAX_DAYS} days`);
  }
  return { from: normalizedFrom, to: normalizedTo };
}

/**
 * @param {unknown} value
 * @param {string} label
 * @returns {number}
 */
export function assertPositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw storeError(`${label} must be a safe integer >= 1`);
  }
  return value;
}

/**
 * Shared so that both adapters reject identical inputs. Postgres also carries
 * CHECK constraints for `attempts` and `seconds` (schema.sql) as a backstop.
 *
 * @param {ResultInput} input
 * @returns {Required<ResultInput>}
 */
export function normalizeResultInput(input) {
  if (input === null || typeof input !== "object") {
    throw storeError("result must be an object");
  }
  const { attempts = null, seconds = null } = input;
  if (attempts !== null && !Number.isInteger(attempts)) {
    throw storeError("attempts must be an integer 1..6 or null for a loss");
  }
  if (attempts !== null && (attempts < ATTEMPTS_MIN || attempts > ATTEMPTS_MAX)) {
    throw storeError("attempts must be an integer 1..6 or null for a loss");
  }
  if (
    seconds !== null &&
    (!Number.isSafeInteger(seconds) || seconds < 0 || seconds > SECONDS_MAX)
  ) {
    throw storeError(`seconds must be an integer 0..${SECONDS_MAX} or null`);
  }
  if (typeof input.besa !== "boolean" || typeof input.hint !== "boolean") {
    throw storeError("besa and hint must be booleans");
  }
  return {
    circleCode: assertKey(input.circleCode, "circleCode"),
    memberKey: assertKey(input.memberKey, "memberKey"),
    playDate: assertDateKey(input.playDate, "playDate"),
    attempts,
    besa: input.besa,
    hint: input.hint,
    seconds,
  };
}

/**
 * Selects the adapter by `env.RRETHI_STORE` — `'memory'` (the default) or
 * `'neon'`.
 *
 * Both adapters are loaded with a dynamic `import()` on purpose. The repository
 * ships with zero runtime dependencies on the default path and CI may run the
 * test suite without `npm install`, so `store-neon.js` — and, inside it,
 * `@neondatabase/serverless` — must not be reachable from any eagerly resolved
 * import when `RRETHI_STORE` is unset. `rm -rf node_modules && npm test` is
 * green because of this.
 *
 * @param {Record<string, string|undefined>} [env]
 * @returns {Promise<RrethiStore>}
 */
export async function createStore(env = process.env) {
  const kind = String(env?.RRETHI_STORE ?? "memory").trim().toLowerCase() || "memory";
  if (kind === "memory") {
    const { createMemoryStore } = await import("./store-memory.js");
    return createMemoryStore();
  }
  if (kind === "neon") {
    const { createNeonStore } = await import("./store-neon.js");
    return createNeonStore(env);
  }
  throw storeError(
    `unknown RRETHI_STORE ${JSON.stringify(kind)} (expected "memory" or "neon")`,
  );
}
