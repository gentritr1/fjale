// Bearer auth and identity derivation — PLAN-RRETHI-M1-API.md §2.
//
// `member_key = HMAC-SHA-256(pepper, secret)`. The server never mints the
// secret, never stores it, and never returns a recovery code: the client
// generates the 128-bit secret and the recovery code *is* that secret,
// re-encoded client-side (deviation D1). What the server holds is a one-way
// hash under a pepper it must back up and must never rotate — rotation orphans
// every member row irreversibly, which is the intended privacy property (§2.2)
// and the reason the pepper belongs in the deploy runbook as backup-critical.
//
// Log redaction is not advisory here. The raw bearer, the derived memberKey and
// every circle code are all absent from every log line this service can emit —
// see `boundedErrorFields`, which is the only shape allowed out. A memberKey in
// a log is the one copy of an identity that survives DELETE /api/rrethi/me and
// quietly breaks §2.10's "immediate and irreversible"; a circle code in a log
// is an invite credential to a family's board.

import { createHmac } from "node:crypto";

/** Same rule health.js already reports on as `identity: "misconfigured"`. */
export const PEPPER_PATTERN = /^[0-9a-f]{64}$/iu;

/**
 * Canonical wire form of the secret: 128 bits as 26 Crockford base32
 * characters, uppercase, no separators, no checksum character. Crockford's
 * alphabet excludes I, L, O and U.
 *
 * The server never accepts the `RKTH-…` recovery display form. The client
 * strips the label, the dashes and the checksum and validates the checksum
 * locally, so a typo costs no round trip — and the server needs no second
 * checksum implementation that could drift from the client's.
 */
export const BEARER_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/u;

/**
 * @param {Record<string, string|undefined>} env
 * @returns {Buffer|null} the 32 pepper bytes, or null when unusable
 */
export function pepperBytes(env) {
  const pepper = String(env?.RRETHI_SERVER_PEPPER ?? "");
  if (!PEPPER_PATTERN.test(pepper)) return null;
  return Buffer.from(pepper, "hex");
}

/**
 * Extracts the secret from an `Authorization` header, or null when the header
 * is missing or not canonical.
 *
 * A non-canonical token is rejected here — before any HMAC, any member lookup,
 * and any member-scoped rate-limit take — because a malformed token has no
 * member to charge. It falls to the anonymous bucket instead (§3).
 *
 * @param {unknown} headerValue
 * @returns {string|null}
 */
export function parseBearer(headerValue) {
  const header = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (typeof header !== "string") return null;
  const match = /^Bearer (.+)$/u.exec(header.trim());
  if (match === null) return null;
  const secret = match[1];
  return BEARER_PATTERN.test(secret) ? secret : null;
}

/**
 * @param {string} secret canonical, already checked against BEARER_PATTERN
 * @param {Buffer} pepper
 * @returns {string} 64 lowercase hex characters
 */
export function deriveMemberKey(secret, pepper) {
  return createHmac("sha256", pepper).update(secret, "utf8").digest("hex");
}

/**
 * Bucket keys are HMACs, never raw identifiers, truncated to 128 bits.
 *
 * `rate_bucket` has no foreign key and no delete cascade, so a raw memberKey
 * stored there would survive DELETE /api/rrethi/me and be trivially joinable to
 * the identity just erased. An HMAC is one-way, so a surviving bucket row is
 * unlinkable — which is exactly why §8.9 can say bucket rows are not erased.
 *
 * @param {string} scope
 * @param {string} value
 * @param {Buffer} pepper
 * @returns {string} 32 hex characters
 */
export function scopedHash(scope, value, pepper) {
  return createHmac("sha256", pepper).update(`${scope}:${value}`).digest("hex").slice(0, 32);
}

/**
 * The only fields any log line in this service may carry, both regex-clamped —
 * the pair health.js already logs.
 *
 * `store.js` guarantees every adapter error is a plain Error whose message
 * starts with `rrethi: `, with the driver error hidden in `cause`. `cause` is
 * never read here and never serialised anywhere, because a Postgres connection
 * error message can embed the connection URL.
 *
 * @param {unknown} error
 * @returns {{name:string, code:string}}
 */
export function boundedErrorFields(error) {
  const name = /^[a-z][a-z0-9_.-]{0,63}$/iu.test(String(error?.name ?? ""))
    ? String(error.name)
    : "Error";
  const code = /^[a-z0-9_.-]{1,32}$/iu.test(String(error?.code ?? ""))
    ? String(error.code)
    : "unknown";
  return { name, code };
}
