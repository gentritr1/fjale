// Rate-limit policy — PLAN-RRETHI-M1-API.md §3, from plan §2.5.
//
// `takeToken(bucket, limit, windowMs)` is the only primitive; this module owns
// which buckets exist and what they cost. Exactly one bucket take per request in
// the common case: the member bucket when the bearer is canonical, the anonymous
// bucket when it is not, never both — a request cannot be simultaneously
// authenticated and anonymous, so charging both would double the cost of every
// request for no extra protection. The two daily buckets are the exceptions and
// are taken only by `POST /circles` and `POST /circles/:code/join`, after
// validation passes and before the write.
//
// Honest cost note, carried over from §3.2 so it is not lost: with
// RRETHI_STORE=neon the minute bucket is one `rate_bucket` upsert per request,
// including on cheap board reads. M1 pays it because §2.12's acceptance ("61
// requests in a minute produce exactly one 429") is only true of a globally
// counted bucket, and a per-instance memory counter on Vercel gives
// `limit × instances`. If M4's CU-hour measurement shows this upsert is the
// binding cost, the named fallback is to move the read endpoints to a
// per-instance in-memory limiter and downgrade their guarantee to best-effort
// in writing — not silently, and not speculatively.

import { scopedHash } from "./auth.js";

export const MINUTE_LIMIT = 60;
export const MINUTE_WINDOW_MS = 60_000;
export const CREATE_LIMIT = 10;
export const JOIN_LIMIT = 20;
export const DAY_WINDOW_MS = 86_400_000;

/**
 * `Retry-After` for a spent daily bucket. `takeToken` does not expose
 * `window_start`, and that is deliberate rather than a gap: a too-small
 * retry-after costs the client one wasted retry, while leaking the exact window
 * start would let a caller schedule around the limiter precisely.
 */
export const DAY_RETRY_AFTER_SECONDS = 3600;
export const MINUTE_RETRY_AFTER_SECONDS = 60;

const KEY_PREFIX = "rl1";

/**
 * Per-member minute bucket. Keyed by an HMAC of the memberKey rather than the
 * memberKey itself — see `scopedHash` for why that is load-bearing for §2.10.
 *
 * @param {string} memberKey
 * @param {Buffer} pepper
 */
export function memberMinuteBucket(memberKey, pepper) {
  return `${KEY_PREFIX}:min:${scopedHash("min", memberKey, pepper)}`;
}

/** @param {string} memberKey @param {Buffer} pepper */
export function circleCreateBucket(memberKey, pepper) {
  return `${KEY_PREFIX}:create:${scopedHash("create", memberKey, pepper)}`;
}

/** @param {string} memberKey @param {Buffer} pepper */
export function joinBucket(memberKey, pepper) {
  return `${KEY_PREFIX}:join:${scopedHash("join", memberKey, pepper)}`;
}

/**
 * The anonymous bucket, for requests whose bearer is missing or malformed.
 *
 * Plan §2.5: "a raw IP or plain hash is never stored … short-lived HMAC of the
 * IP plus the current window, rotated and pruned within 48 hours". The hour
 * index is what rotates it: no bucket row is a durable identifier for an
 * address, and at most 24 rows per address per day can exist.
 *
 * The raw IP lives only as a parameter to this function. It is never stored,
 * never logged, never returned, and never used for anything else — there is no
 * IP-reputation logic anywhere, which plan §2.5 names as a deliberate non-goal.
 *
 * @param {unknown} forwardedFor value of `x-forwarded-for`, if any
 * @param {Buffer} pepper
 * @param {number} nowMs
 */
export function anonymousBucket(forwardedFor, pepper, nowMs) {
  const header = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  const first = String(header ?? "").split(",")[0].trim();
  // Clients we cannot distinguish share one bucket and so share one 60/min
  // allowance, which is the conservative direction.
  const ip = first === "" ? "unknown" : first;
  const hourIndex = Math.floor(nowMs / 3_600_000);
  return `${KEY_PREFIX}:ip:${scopedHash("ip", `${hourIndex}:${ip}`, pepper)}`;
}
