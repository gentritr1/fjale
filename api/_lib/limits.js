// Rate-limit policy — PLAN-RRETHI-M1-API.md §3, from plan §2.5.
//
// `takeToken(bucket, limit, windowMs)` is the only primitive; this module owns
// which buckets exist and what they cost. At most one minute-bucket take per
// request, and only after the caller is identified: no canonical bearer means no
// bucket and no store call at all (PLAN-RRETHI-M1-API.md §12 D11). The two daily
// buckets are the exceptions and
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
