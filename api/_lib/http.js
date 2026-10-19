// Shared HTTP envelope for the nine Rrethi endpoints — PLAN-RRETHI-M1-API.md §1.
//
// This is `api/health.js`'s discipline, lifted out so it is written once. Nine
// copies of a preamble are nine places for the spoiler rule or the redaction
// rule to drift, which is why M1 ships one router rather than nine files.
//
// Two rules this module exists to make unbreakable:
//
//   1. Every response carries the same headers, set before any branch runs, so
//      an early 405 is as `no-store` as a 200. `vercel.json` sets two of them
//      for /api/(.*) as well; the handler sets them anyway because plan §2.7
//      requires `no-store` to hold independently of a config file, and the
//      local dev server never reads vercel.json.
//   2. There is exactly one error shape and it has no `message` key, ever. A
//      code plus an optional field name is all a client needs to show its own
//      Albanian copy, and it is the only shape that cannot leak a driver
//      string, a SQLSTATE, a hostname, a schema name, or a stack.

import { storeError } from "./store.js";

const JSON_HEADERS = Object.freeze({
  "Cache-Control": "private, no-store, max-age=0",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
});

/**
 * The closed error-code set of §1.1. Any status not produced from this table is
 * a bug; `assertKnownError` below is the runtime guard that says so.
 */
export const ERROR_STATUS = Object.freeze({
  not_found: 404,
  method_not_allowed: 405,
  unsupported_media_type: 415,
  payload_too_large: 413,
  malformed_json: 400,
  invalid_field: 400,
  invalid_date: 400,
  date_out_of_range: 400,
  unauthorized: 401,
  unknown_member: 401,
  forbidden_origin: 403,
  not_a_member: 403,
  circle_full: 409,
  circle_limit_reached: 409,
  result_exists: 409,
  rate_limited: 429,
  server_error: 500,
  not_configured: 503,
});

/** The closed list of values `field` may take (§1.1). */
export const ERROR_FIELDS = Object.freeze([
  "displayName",
  "avatarId",
  "letterSeal",
  "name",
  "code",
  "date",
  "start",
  "attempts",
  "besa",
  "hint",
  "seconds",
]);

/** Bodies over this are refused while streaming, never buffered (§1). */
export const BODY_MAX_BYTES = 2048;

/**
 * A refusal a caller can convert straight into a response. Carried as a value
 * rather than thrown, in the same discipline `store.js` sets for expected
 * outcomes.
 *
 * @param {keyof typeof ERROR_STATUS} error
 * @param {string} [field]
 */
export function refusal(error, field) {
  if (!Object.hasOwn(ERROR_STATUS, error)) {
    throw storeError(`unknown error code ${JSON.stringify(error)}`);
  }
  if (field !== undefined && !ERROR_FIELDS.includes(field)) {
    throw storeError(`unknown error field ${JSON.stringify(field)}`);
  }
  return field === undefined ? { error } : { error, field };
}

/** Sets the header block every response shares. Call before any branch. */
export function applyBaseHeaders(response) {
  for (const [name, value] of Object.entries(JSON_HEADERS)) {
    response.setHeader(name, value);
  }
}

/**
 * @param {object} response
 * @param {number} statusCode
 * @param {unknown} body
 */
export function sendJson(response, statusCode, body) {
  const payload = `${JSON.stringify(body)}\n`;
  response.setHeader("Content-Length", Buffer.byteLength(payload));
  response.statusCode = statusCode;
  response.end(payload);
}

/**
 * The only way an error leaves this service.
 *
 * @param {object} response
 * @param {{error:string, field?:string}} refused
 * @param {Record<string,string>} [extraHeaders]
 */
export function sendError(response, refused, extraHeaders = {}) {
  const statusCode = ERROR_STATUS[refused.error];
  if (statusCode === undefined) {
    throw storeError(`unknown error code ${JSON.stringify(refused.error)}`);
  }
  for (const [name, value] of Object.entries(extraHeaders)) {
    response.setHeader(name, value);
  }
  const body = { status: "error", error: refused.error };
  if (refused.field !== undefined) body.field = refused.field;
  sendJson(response, statusCode, body);
}

/**
 * 204 with an explicit `Content-Length: 0`, so §1's "every response carries
 * Content-Length" holds uniformly and the header assertion covers this path too.
 */
export function sendNoContent(response) {
  response.setHeader("Content-Length", 0);
  response.statusCode = 204;
  response.end();
}

/**
 * Parses the request URL. A malformed URL is a refusal, never a crash.
 *
 * @param {object} request
 * @returns {URL|null}
 */
export function parseRequestUrl(request) {
  try {
    return new URL(String(request?.url ?? "/"), "http://localhost");
  } catch {
    return null;
  }
}

/**
 * Cross-origin defence for state-changing verbs (§1).
 *
 * The deployment's own origin is derived from `x-forwarded-proto` and `host`
 * rather than a hard-coded constant, which is what makes preview deployments
 * work without an env var. An absent `Origin` is allowed: non-browser clients
 * (curl, the scripted acceptance run) send none, and a browser omits it only on
 * same-origin GETs, which are not state-changing.
 *
 * The second, independent defence is that `OPTIONS` is not implemented at all
 * (it returns 405), so a cross-origin JSON POST can never clear its preflight.
 *
 * **Why the scheme is not simply defaulted to `https`.** §1 says "default
 * `https`", and behind Vercel that is always right because the platform sets
 * `x-forwarded-proto` on every request. On the local dev server there is no such
 * header and no TLS, so a hard `https` default derives `https://localhost:4174`
 * while the browser sends `Origin: http://localhost:4174` — and *every*
 * same-origin browser POST is refused with 403. That was measured in a real
 * service-worker-controlled browser, not reasoned about: neither the unit
 * harness nor node's `fetch` sends an `Origin` header on a same-origin request,
 * so no test could see it, and it would have ambushed M2's first UI POST.
 * The scheme therefore comes from the connection when the header is absent.
 * This stays fail-closed in every direction: a mismatch is still a 403, and a
 * TLS-terminating proxy that strips `x-forwarded-proto` would derive `http` and
 * refuse an `https` Origin rather than admit anything extra.
 *
 * @param {object} request
 * @returns {boolean} true when the request may proceed
 */
export function isSameOrigin(request) {
  const headers = request?.headers ?? {};
  const presented = headers.origin;
  if (presented === undefined || presented === null || presented === "") {
    return true;
  }
  const host = String(firstHeaderValue(headers.host) ?? "").trim();
  if (host === "") return false;
  return String(presented) === `${requestScheme(request)}://${host}`;
}

/**
 * `x-forwarded-proto` when a proxy set it (the production path), otherwise the
 * scheme this connection actually arrived on. With no socket at all — a unit
 * harness — §1's documented `https` default stands.
 */
function requestScheme(request) {
  const forwarded = firstHeaderValue(request?.headers?.["x-forwarded-proto"]);
  if (typeof forwarded === "string" && forwarded.trim() !== "") {
    // A comma-joined chain keeps the client-facing hop first.
    return forwarded.split(",")[0].trim().toLowerCase();
  }
  const socket = request?.socket;
  if (socket === undefined || socket === null) return "https";
  return socket.encrypted === true ? "https" : "http";
}

/** Header values arrive as a string or, for repeated headers, an array. */
export function firstHeaderValue(value) {
  if (Array.isArray(value)) return value.length === 0 ? undefined : value[0];
  return value;
}

/**
 * Reads and parses a JSON request body under a hard byte cap.
 *
 * Unknown keys are ignored rather than rejected, so a newer client field does
 * not break an older deployment; the 2 KiB cap is what keeps that leniency from
 * being a memory hole. The largest legal body is under 120 bytes.
 *
 * @param {object} request
 * @returns {Promise<{ok:true, body:Record<string,unknown>} | {ok:false, refusal:{error:string, field?:string}}>}
 */
export async function readJsonBody(request) {
  const contentType = String(firstHeaderValue(request?.headers?.["content-type"]) ?? "")
    .trim()
    .toLowerCase();
  const [mediaType, ...parameters] = contentType.split(";").map((part) => part.trim());
  if (mediaType !== "application/json") {
    return { ok: false, refusal: refusal("unsupported_media_type") };
  }
  if (parameters.some((parameter) => parameter !== "" && parameter !== "charset=utf-8")) {
    return { ok: false, refusal: refusal("unsupported_media_type") };
  }

  // A declared over-cap length is refused before a single byte is read.
  const declared = Number(firstHeaderValue(request?.headers?.["content-length"]) ?? Number.NaN);
  if (Number.isFinite(declared) && declared > BODY_MAX_BYTES) {
    return { ok: false, refusal: refusal("payload_too_large") };
  }

  const raw = await readRawBody(request);
  if (raw === null) {
    return { ok: false, refusal: refusal("payload_too_large") };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw === "" ? "null" : raw);
  } catch {
    return { ok: false, refusal: refusal("malformed_json") };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, refusal: refusal("malformed_json") };
  }
  return { ok: true, body: parsed };
}

/**
 * Streams the body, abandoning it the moment it exceeds the cap — the bytes past
 * the cap are never accumulated. Returns `null` when the cap is exceeded.
 *
 * The `request.body` branch exists because Vercel's Node runtime may already
 * have consumed and parsed the stream; there the cap is applied to the
 * re-serialised body instead, which is the same bound on the same content.
 *
 * @param {object} request
 * @returns {Promise<string|null>}
 */
async function readRawBody(request) {
  const preparsed = request?.body;
  if (preparsed !== undefined && preparsed !== null && typeof preparsed !== "string" && !Buffer.isBuffer(preparsed)) {
    const serialised = JSON.stringify(preparsed);
    return Buffer.byteLength(serialised) > BODY_MAX_BYTES ? null : serialised;
  }
  if (typeof preparsed === "string" || Buffer.isBuffer(preparsed)) {
    return Buffer.byteLength(preparsed) > BODY_MAX_BYTES ? null : String(preparsed);
  }

  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > BODY_MAX_BYTES) {
      // Stop accumulating immediately: nothing past the cap is ever held.
      if (typeof request.destroy === "function") request.destroy();
      return null;
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}
