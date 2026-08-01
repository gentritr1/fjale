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
 * A player. `memberKey` is `sha256(secret || server_pepper)` (plan §2.2); the
 * raw secret is never stored and never reaches this layer.
 *
 * @typedef {object} Member
 * @property {string} memberKey
 * @property {string} displayName
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
 * - `createMember` / `createCircle` / `addMembership` are insert-if-absent.
 *   On an existing key they are a silent no-op and never overwrite; a caller
 *   that must detect a collision reads first (M1's circle-code generator).
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
 *   M1 policy (plan §2.5).
 *
 * @typedef {object} RrethiStore
 * @property {(key:string, name:string) => Promise<void>}                createMember
 * @property {(key:string) => Promise<?Member>}                          getMember
 * @property {(key:string, name:string) => Promise<void>}                renameMember
 * @property {(key:string) => Promise<void>}                             deleteMember
 * @property {(code:string, name:string, owner:string) => Promise<void>} createCircle
 * @property {(code:string) => Promise<?Circle>}                         getCircle
 * @property {(code:string, key:string) => Promise<void>}                addMembership
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
// Known M0 gap, not a deviation: nothing updates `member.last_seen_at` after
// `createMember`. The plan's interface has no touch method and M0 has no
// request path to call one from; M1 adds it with the bearer-auth middleware.

/** Calendar dates cross this boundary as strings, never as `Date`. */
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

/** Attempts are 1..6, or `null` for a loss (plan §2.5 shape rule). */
export const ATTEMPTS_MIN = 1;
export const ATTEMPTS_MAX = 6;

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
  if (typeof value !== "string" || value === "") {
    throw storeError(`${label} must be a non-empty string`);
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
    throw storeError(`${label} must be a YYYY-MM-DD string, not a Date`);
  }
  return value;
}

/**
 * @param {unknown} value
 * @param {string} label
 * @returns {number}
 */
export function assertPositiveInteger(value, label) {
  if (!Number.isInteger(value) || value < 1) {
    throw storeError(`${label} must be an integer >= 1`);
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
  if (seconds !== null && (!Number.isInteger(seconds) || seconds < 0)) {
    throw storeError("seconds must be a non-negative integer or null");
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
