// The Rrethi router: all nine M1 endpoints — PLAN-RRETHI-M1-API.md §8.
//
// One router, not nine files. Vercel Hobby caps functions per deployment, every
// route shares the same auth/limit/envelope preamble, and nine copies of that
// preamble is nine places for the spoiler rule or the redaction rule to drift.
// Path parsing is a switch over a split pathname, not a regex zoo.
//
// `api/rrethi/[[...path]].js` is the Vercel entry point and does nothing but
// re-export this module. The implementation lives here so `server.mjs` and the
// test suite can import it by a path without `[[...]]` in it, which URL parsing
// percent-encodes.
//
// Three rules an editor of this file must not break:
//
//   * The handlers perform no masking. `board.js` decides what a viewer may see;
//     a handler that "helpfully" adds `attempts: null` to a masked row breaks
//     the M1 acceptance test, which asserts on the raw response text.
//   * Nothing derived from identity is ever logged — not the bearer, not the
//     memberKey, not a circle code. `boundedErrorFields` is the only shape that
//     leaves this process.
//   * Scoring is `weeklyPoints` from `src/points.js` and dates are
//     `getTiranaDateKey`/`tiranaMidnightEpoch` from `src/game.js`. A second
//     implementation of either is how epochs and scores drift apart.

import { randomBytes } from "node:crypto";

import {
  ALBANIAN_ALPHABET,
  dateKeyFromOrdinal,
  dateKeyOrdinal,
  getTiranaDateKey,
  normalizeWord,
  tiranaMidnightEpoch,
} from "../../src/game.js";
import { isAvatarId } from "../../src/avatars.js";
import { weeklyPoints } from "../../src/points.js";
import { buildBoard, isBoardMasked } from "./board.js";
import { boundedErrorFields, parseBearer, pepperBytes, deriveMemberKey } from "./auth.js";
import {
  CIRCLE_MAX_MEMBERS,
  CONTROL_CHARACTER_PATTERN,
  FOREIGN_KEY_MESSAGE,
  MEMBER_MAX_CIRCLES,
  SECONDS_MAX,
  assertDateKey,
  createStore,
} from "./store.js";
import {
  CREATE_LIMIT,
  DAY_RETRY_AFTER_SECONDS,
  DAY_WINDOW_MS,
  JOIN_LIMIT,
  MINUTE_LIMIT,
  MINUTE_RETRY_AFTER_SECONDS,
  MINUTE_WINDOW_MS,
  anonymousBucket,
  circleCreateBucket,
  joinBucket,
  memberMinuteBucket,
} from "./limits.js";
import {
  applyBaseHeaders,
  firstHeaderValue,
  isSameOrigin,
  parseRequestUrl,
  readJsonBody,
  refusal,
  sendError,
  sendJson,
  sendNoContent,
} from "./http.js";

const ROUTE_PREFIX = "/api/rrethi";

/** Crockford base32, uppercase. I, L, O and U are excluded by design. */
const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LENGTH = 13; // ~65 bits (plan §2.5)
const CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{13}$/u;

/** Plan §2.5: today's or yesterday's Tirana date, with a 6-hour grace. */
const RESULT_GRACE_MS = 6 * 60 * 60 * 1000;

/** Plan §2.10 retention: nothing older than this is readable. */
const HISTORY_MAX_DAYS = 400;

const EXTENDED_PICTOGRAPHIC = /\p{Extended_Pictographic}/u;
const NAME_MIN_CODE_POINTS = 2;
const NAME_MAX_CODE_POINTS = 20;
const NAME_MAX_EMOJI = 2;

// ---------------------------------------------------------------------------
// Field validation (§8.0). These are plan §2.5's rules and store.js's, not new
// ones — the store's own assertions stay as the backstop behind them.
// ---------------------------------------------------------------------------

/**
 * The shared `displayName` rule, which circle `name` reuses character for
 * character (§11, O1 — one validator, one rule to remember).
 *
 * No profanity filter: plan §2.5 names it a deliberate non-goal.
 *
 * @param {unknown} raw
 * @returns {string|null} the normalised value, or null when it fails
 */
function normalizeName(raw) {
  if (typeof raw !== "string") return null;
  const value = raw.trim().normalize("NFC");
  const codePoints = Array.from(value);
  if (codePoints.length < NAME_MIN_CODE_POINTS || codePoints.length > NAME_MAX_CODE_POINTS) {
    return null;
  }
  if (CONTROL_CHARACTER_PATTERN.test(value)) return null;
  const pictographs = codePoints.filter((point) => EXTENDED_PICTOGRAPHIC.test(point)).length;
  if (pictographs > NAME_MAX_EMOJI) return null;
  return value;
}

/**
 * The server validates the avatar against the fixed catalog and deliberately
 * does not check whether the badge behind an earned avatar was actually earned:
 * plan §2.1.1 is explicit that policing a locally altered cosmetic would mean
 * transmitting badge history for no security benefit.
 */
function normalizeAvatarId(raw) {
  return typeof raw === "string" && isAvatarId(raw) ? raw : null;
}

function normalizeLetterSeal(raw) {
  if (typeof raw !== "string") return null;
  const value = normalizeWord(raw);
  return ALBANIAN_ALPHABET.includes(value) ? value : null;
}

/**
 * Normalises an invite code to its canonical form before the store ever sees it.
 *
 * Cosmetics are the client's: the shared form is `RR-8G2K-4M9P-1QRTV`, so the
 * label and the dashes come off here, and Crockford's confusables are folded
 * (I and L read as 1, O reads as 0) so a code copied off a screen still works.
 *
 * The `RR` label is stripped by length rather than by prefix match, because `R`
 * is itself in the alphabet and a legitimate code may begin with `RR`.
 */
function normalizeCircleCode(raw) {
  if (typeof raw !== "string") return null;
  let value = raw.toUpperCase().replaceAll("-", "");
  if (value.length === CODE_LENGTH + 2 && value.startsWith("RR")) {
    value = value.slice(2);
  }
  value = value.replaceAll("I", "1").replaceAll("L", "1").replaceAll("O", "0");
  return CODE_PATTERN.test(value) ? value : null;
}

/**
 * `attempts` is 1..6 for a win or the string `"X"` for a loss, which is the
 * shape plan §2.5 states and the share text uses. `null` on the wire would be
 * ambiguous with "absent", so the handler maps `"X"` to the store's `null`.
 *
 * @returns {{ok:true, value:?number}|{ok:false}}
 */
function normalizeAttempts(raw) {
  if (raw === "X") return { ok: true, value: null };
  if (Number.isInteger(raw) && raw >= 1 && raw <= 6) return { ok: true, value: raw };
  return { ok: false };
}

/** @returns {{ok:true, value:?number}|{ok:false}} */
function normalizeSeconds(raw) {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (Number.isSafeInteger(raw) && raw >= 0 && raw <= SECONDS_MAX) {
    return { ok: true, value: raw };
  }
  return { ok: false };
}

/** A real `YYYY-MM-DD` calendar date, with `assertDateKey` as the referee. */
function normalizeDateKey(raw) {
  if (typeof raw !== "string") return null;
  try {
    return assertDateKey(raw, "date");
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Dates. Every calendar question is answered by src/game.js.
// ---------------------------------------------------------------------------

/**
 * The dates a result may be filed under (§5): today, plus yesterday for six
 * hours of elapsed real time after the exact instant of Tirana midnight.
 *
 * Elapsed time, not wall-clock hours: asking "what is the local hour now" needs
 * a second date implementation, which §2.4 forbids. Elapsed time is also
 * monotone, so the window never reopens. On the spring-forward day it ends at
 * 07:00 local and on the fall-back day at 05:00 local — that is the right
 * answer, not a bug.
 *
 * @param {Date} now
 * @returns {string[]}
 */
export function allowedPlayDates(now) {
  const todayKey = getTiranaDateKey(now);
  const [year, month, day] = todayKey.split("-").map(Number);
  const midnight = tiranaMidnightEpoch(year, month, day);
  if (now.getTime() >= midnight + RESULT_GRACE_MS) {
    return [todayKey];
  }
  // One millisecond before local midnight is unambiguously yesterday, on every
  // day of the year including both DST transitions. Never subtract 86_400_000
  // from `now` to get "yesterday".
  return [todayKey, getTiranaDateKey(new Date(midnight - 1))];
}

/** 0 = Sunday. Pure ordinal arithmetic on a key that is already a Tirana date. */
function weekdayOf(dateKey) {
  return (((dateKeyOrdinal(dateKey) + 4) % 7) + 7) % 7;
}

function mondayOf(dateKey) {
  const back = (weekdayOf(dateKey) + 6) % 7;
  return dateKeyFromOrdinal(dateKeyOrdinal(dateKey) - back);
}

/**
 * Is a requested date inside the readable window? Future is compared
 * lexicographically against today's key — the same comparison the fake-clock
 * tests pin — and the floor is plan §2.10's 400-day retention.
 */
function isReadableDate(dateKey, now) {
  const todayKey = getTiranaDateKey(now);
  if (dateKey > todayKey) return false;
  return dateKeyOrdinal(dateKey) >= dateKeyOrdinal(todayKey) - HISTORY_MAX_DAYS;
}

// ---------------------------------------------------------------------------
// Circle codes
// ---------------------------------------------------------------------------

/**
 * 13 Crockford characters from `randomBytes`, five bits at a time.
 *
 * Masking to five bits is what makes it unbiased: `% 32` over a byte would make
 * the first eight symbols of the alphabet ~1.5% likelier than the rest, and at
 * 65 bits of invite credential that bias is not worth taking for free.
 */
function generateCircleCode() {
  const out = [];
  while (out.length < CODE_LENGTH) {
    for (const byte of randomBytes(CODE_LENGTH)) {
      out.push(CODE_ALPHABET[byte & 0b11111]);
      if (out.length === CODE_LENGTH) break;
    }
  }
  return out.join("");
}

// ---------------------------------------------------------------------------
// Routing table
// ---------------------------------------------------------------------------

/**
 * Resolves a pathname under `/api/rrethi` to a route.
 *
 * @param {string} pathname
 * @returns {{name:string, methods:string[], code?:string}|null}
 */
function matchRoute(pathname) {
  const rest = pathname.slice(ROUTE_PREFIX.length);
  const segments = rest.split("/").filter((segment) => segment !== "");

  if (segments.length === 1 && segments[0] === "members") {
    return { name: "createMember", methods: ["POST"] };
  }
  if (segments.length === 1 && segments[0] === "me") {
    return { name: "deleteMe", methods: ["DELETE"] };
  }
  if (segments.length === 1 && segments[0] === "circles") {
    return { name: "createCircle", methods: ["POST"] };
  }
  if (segments.length >= 2 && segments[0] === "circles") {
    const code = segments[1];
    if (segments.length === 2) return { name: "getCircle", methods: ["GET"], code };
    if (segments.length === 3 && segments[2] === "join") {
      return { name: "join", methods: ["POST"], code };
    }
    if (segments.length === 3 && segments[2] === "results") {
      return { name: "postResult", methods: ["POST"], code };
    }
    if (segments.length === 3 && segments[2] === "board") {
      return { name: "board", methods: ["GET"], code };
    }
    if (segments.length === 3 && segments[2] === "week") {
      return { name: "week", methods: ["GET"], code };
    }
    if (segments.length === 4 && segments[2] === "members" && segments[3] === "me") {
      return { name: "leave", methods: ["DELETE"], code };
    }
  }
  return null;
}

/**
 * Endpoint 1 tolerates a bearer with no row behind it — it is the endpoint that
 * creates the row. Endpoint 9 needs no row at all and deliberately does not read
 * one: touching a row you are about to delete is a wasted write and a race with
 * the delete (§2.4, §8.9).
 */
const TOLERATES_MISSING_MEMBER = new Set(["createMember"]);
const SKIPS_MEMBER_LOOKUP = new Set(["deleteMe"]);

// ---------------------------------------------------------------------------
// The request preamble
// ---------------------------------------------------------------------------

/** One store per process, not one per request: a fresh memory store each time
 *  would forget every member between calls. Tests inject their own. */
let storePromise = null;

function resolveStore(env, injected) {
  if (injected !== undefined) return Promise.resolve(injected);
  if (storePromise === null) storePromise = createStore(env);
  return storePromise;
}

/** Test-only: drops the memoized store so a suite can start from empty. */
export function resetStoreForTests() {
  storePromise = null;
}

/**
 * @param {object} request
 * @param {object} response
 * @param {Record<string, string|undefined>} [env]
 * @param {{store?:object, now?:() => Date}} [options]
 */
export async function handleRrethiRequest(request, response, env = process.env, options = {}) {
  applyBaseHeaders(response);
  const now = options.now ?? (() => new Date());

  // §3.2 step 0. A disabled service answers 404 for free, before any bucket take
  // or store call: it must not write rate_bucket rows while switched off. Plan
  // §2.10 requires the rewritten privacy page to ship in the same deploy as the
  // first live /api route, and this gate is what lets M1 be deployable and
  // testable before M3 writes that page (§11, O6).
  if (String(env?.RRETHI_API_ENABLED ?? "") !== "1") {
    sendError(response, refusal("not_found"));
    return;
  }

  const url = parseRequestUrl(request);
  if (url === null) {
    sendError(response, refusal("invalid_field"));
    return;
  }

  const route = matchRoute(decodeSafe(url.pathname));
  if (route === null) {
    // 404 covers "no such route", "no such circle" and "gate off" alike. A
    // circle code is a 65-bit invite credential; distinguishing those cases
    // would confirm nothing useful and collapsing them costs nothing.
    sendError(response, refusal("not_found"));
    return;
  }

  const method = String(request.method ?? "GET").toUpperCase();
  if (!route.methods.includes(method)) {
    // OPTIONS lands here too, deliberately: refusing to answer preflights is a
    // second, independent CSRF defence behind the origin check.
    sendError(response, refusal("method_not_allowed"), { Allow: route.methods.join(", ") });
    return;
  }

  if ((method === "POST" || method === "DELETE") && !isSameOrigin(request)) {
    sendError(response, refusal("forbidden_origin"));
    return;
  }

  // Before any store call, so a misconfigured deployment cannot hash with a weak
  // or empty key and cannot spend database compute.
  const pepper = pepperBytes(env);
  if (pepper === null) {
    sendError(response, refusal("not_configured"));
    return;
  }

  let body = {};
  if (method === "POST") {
    const read = await readJsonBody(request);
    if (!read.ok) {
      sendError(response, read.refusal);
      return;
    }
    body = read.body;
  }

  const secret = parseBearer(request.headers?.authorization);
  const memberKey = secret === null ? null : deriveMemberKey(secret, pepper);

  const store = await resolveStore(env, options.store);

  try {
    // §3.2 step 3: exactly one minute bucket per request — the member's when the
    // bearer is canonical, the rotating anonymous one when it is not. Never
    // both; a request cannot be simultaneously authenticated and anonymous.
    const bucket =
      memberKey === null
        ? anonymousBucket(request.headers?.["x-forwarded-for"], pepper, now().getTime())
        : memberMinuteBucket(memberKey, pepper);
    if (!(await store.takeToken(bucket, MINUTE_LIMIT, MINUTE_WINDOW_MS))) {
      sendError(response, refusal("rate_limited"), {
        "Retry-After": String(MINUTE_RETRY_AFTER_SECONDS),
      });
      return;
    }

    if (memberKey === null) {
      sendError(response, refusal("unauthorized"));
      return;
    }

    let member = null;
    if (!SKIPS_MEMBER_LOOKUP.has(route.name)) {
      member = await store.getMember(memberKey);
      if (member === null && !TOLERATES_MISSING_MEMBER.has(route.name)) {
        sendError(response, refusal("unknown_member"));
        return;
      }
      if (member !== null) {
        // Fire-and-forget bookkeeping: a failed last_seen_at write must never
        // turn a successful board read into a 500.
        try {
          await store.touchMember(memberKey);
        } catch (error) {
          console.error("rrethi: touch failed", boundedErrorFields(error));
        }
      }
    }

    const context = { store, env, pepper, memberKey, member, body, url, route, now };
    const handler = HANDLERS[route.name];
    const outcome = await handler(context);
    if (outcome.refusal !== undefined) {
      sendError(response, outcome.refusal, outcome.headers ?? {});
      return;
    }
    if (outcome.noContent === true) {
      sendNoContent(response);
      return;
    }
    sendJson(response, outcome.status, outcome.body);
  } catch (error) {
    // Every adapter error lands here. `store.js` guarantees it is a plain Error
    // whose message starts with `rrethi: ` and whose driver detail rides in
    // `cause` — which is never read, never logged and never serialised, because
    // a Postgres connection error message can embed the connection URL.
    console.error("rrethi: request failed", boundedErrorFields(error));
    sendError(response, refusal("server_error"));
  }
}

function decodeSafe(pathname) {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

/** Resolves the route's `:code` segment, or a refusal. */
function requireCode(context) {
  const code = normalizeCircleCode(context.route.code);
  return code === null ? { refusal: refusal("invalid_field", "code") } : { code };
}

/** The membership gate the board and week endpoints share. */
async function requireMembership(context, code) {
  const circle = await context.store.getCircle(code);
  if (circle === null) return { refusal: refusal("not_found") };
  const members = await context.store.listMembers(code);
  if (!members.some((member) => member.memberKey === context.memberKey)) {
    return { refusal: refusal("not_a_member") };
  }
  return { circle, members };
}

// ---------------------------------------------------------------------------
// The nine handlers
// ---------------------------------------------------------------------------

const HANDLERS = {
  /** 8.1 POST /api/rrethi/members — register or edit the caller's profile. */
  async createMember(context) {
    const displayName = normalizeName(context.body.displayName);
    if (displayName === null) return { refusal: refusal("invalid_field", "displayName") };
    const avatarId = normalizeAvatarId(context.body.avatarId);
    if (avatarId === null) return { refusal: refusal("invalid_field", "avatarId") };
    const letterSeal = normalizeLetterSeal(context.body.letterSeal);
    if (letterSeal === null) return { refusal: refusal("invalid_field", "letterSeal") };

    await context.store.upsertMember(context.memberKey, { displayName, avatarId, letterSeal });

    // `memberId` is the memberKey: derived from the caller's own secret by a
    // one-way HMAC, returned only to the holder of that secret, and present in
    // no other payload — board.js omits member keys everywhere. No recoveryCode
    // is returned; the client already holds the secret it is an encoding of
    // (deviation D1).
    return {
      status: context.member === null ? 201 : 200,
      body: { memberId: context.memberKey, displayName, avatarId, letterSeal },
    };
  },

  /** 8.2 POST /api/rrethi/circles — not idempotent; a retry makes a second circle. */
  async createCircle(context) {
    const name = normalizeName(context.body.name);
    if (name === null) return { refusal: refusal("invalid_field", "name") };

    const spent = !(await context.store.takeToken(
      circleCreateBucket(context.memberKey, context.pepper),
      CREATE_LIMIT,
      DAY_WINDOW_MS,
    ));
    if (spent) {
      return {
        refusal: refusal("rate_limited"),
        headers: { "Retry-After": String(DAY_RETRY_AFTER_SECONDS) },
      };
    }

    // The cheap pre-check; `claimSeat` below is the invariant that actually
    // holds under concurrency.
    const existing = await context.store.listCirclesFor(context.memberKey);
    if (existing.length >= MEMBER_MAX_CIRCLES) {
      return { refusal: refusal("circle_limit_reached") };
    }

    // At 65 bits a collision is a lottery win; five retries is for the lottery,
    // not for the common case.
    let code = null;
    for (let attempt = 0; attempt < 5 && code === null; attempt += 1) {
      const candidate = generateCircleCode();
      if ((await context.store.createCircle(candidate, name, context.memberKey)) === "created") {
        code = candidate;
      }
    }
    if (code === null) return { refusal: refusal("server_error") };

    const seated = await context.store.claimSeat(
      code,
      context.memberKey,
      CIRCLE_MAX_MEMBERS,
      MEMBER_MAX_CIRCLES,
    );
    // Anything but 'created' on a code minted one statement ago is impossible.
    if (seated !== "created") return { refusal: refusal("server_error") };

    // The client renders the invite URL itself. The server returns the canonical
    // code and never builds a URL: the canonical origin is a client concern and
    // hard-coding it server-side breaks preview deployments.
    return { status: 201, body: { code, name, memberCount: 1 } };
  },

  /** 8.3 GET /api/rrethi/circles/:code — the join card. The code is the invitation. */
  async getCircle(context) {
    const resolved = requireCode(context);
    if (resolved.refusal !== undefined) return resolved;

    const circle = await context.store.getCircle(resolved.code);
    if (circle === null) return { refusal: refusal("not_found") };
    const members = await context.store.listMembers(resolved.code);

    // No display names, no avatars, no seats before joining: shipping names on a
    // pre-join endpoint would hand a full family roster to anyone who ever saw
    // the code, including after they left the circle.
    return {
      status: 200,
      body: {
        code: circle.code,
        name: circle.name,
        memberCount: members.length,
        joined: members.some((member) => member.memberKey === context.memberKey),
      },
    };
  },

  /** 8.4 POST /api/rrethi/circles/:code/join — idempotent by design. */
  async join(context) {
    const resolved = requireCode(context);
    if (resolved.refusal !== undefined) return resolved;

    let displayName = null;
    if (context.body.displayName !== undefined) {
      displayName = normalizeName(context.body.displayName);
      if (displayName === null) return { refusal: refusal("invalid_field", "displayName") };
    }

    const spent = !(await context.store.takeToken(
      joinBucket(context.memberKey, context.pepper),
      JOIN_LIMIT,
      DAY_WINDOW_MS,
    ));
    if (spent) {
      return {
        refusal: refusal("rate_limited"),
        headers: { "Retry-After": String(DAY_RETRY_AFTER_SECONDS) },
      };
    }

    if (displayName !== null) {
      // The display name is global, not per-circle (§2.2): renaming at join
      // renames the member on every board they are on. That is the plan's model.
      // Stated consequence of doing it first: a join against a nonexistent code
      // returns 404 after the rename has already applied. Accepted — the rename
      // is user-intended independently of whether the join lands.
      await context.store.upsertMember(context.memberKey, {
        displayName,
        avatarId: context.member.avatarId,
        letterSeal: context.member.letterSeal,
      });
    }

    const seated = await context.store.claimSeat(
      resolved.code,
      context.memberKey,
      CIRCLE_MAX_MEMBERS,
      MEMBER_MAX_CIRCLES,
    );
    if (seated === "missing") return { refusal: refusal("not_found") };
    if (seated === "full") return { refusal: refusal("circle_full") };
    if (seated === "over_circle_limit") return { refusal: refusal("circle_limit_reached") };

    const circle = await context.store.getCircle(resolved.code);
    if (circle === null) return { refusal: refusal("not_found") };
    const members = await context.store.listMembers(resolved.code);

    return {
      status: seated === "created" ? 201 : 200,
      body: { code: circle.code, name: circle.name, memberCount: members.length },
    };
  },

  /** 8.5 DELETE /api/rrethi/circles/:code/members/me — leave. Always 204. */
  async leave(context) {
    const resolved = requireCode(context);
    if (resolved.refusal !== undefined) return resolved;

    // No getCircle first: removing a membership that does not exist is a no-op
    // in both adapters and the response is the same either way, so the extra
    // read would only add a round trip and a way to probe which codes exist.
    //
    // The owner may leave and the circle survives; ownership is not transferred
    // (§11, O3). Blocking the owner traps them, and deleting the circle would
    // let one person destroy a family's history with a button that reads as
    // harmless.
    await context.store.removeMembership(resolved.code, context.memberKey);
    return { noContent: true };
  },

  /** 8.6 POST /api/rrethi/circles/:code/results — first write wins, row immutable. */
  async postResult(context) {
    const resolved = requireCode(context);
    if (resolved.refusal !== undefined) return resolved;

    const playDate = normalizeDateKey(context.body.date);
    if (playDate === null) return { refusal: refusal("invalid_date") };
    if (!allowedPlayDates(context.now()).includes(playDate)) {
      return { refusal: refusal("date_out_of_range") };
    }

    const attempts = normalizeAttempts(context.body.attempts);
    if (!attempts.ok) return { refusal: refusal("invalid_field", "attempts") };
    if (typeof context.body.besa !== "boolean") return { refusal: refusal("invalid_field", "besa") };
    if (typeof context.body.hint !== "boolean") return { refusal: refusal("invalid_field", "hint") };
    const seconds = normalizeSeconds(context.body.seconds);
    if (!seconds.ok) return { refusal: refusal("invalid_field", "seconds") };

    const circle = await context.store.getCircle(resolved.code);
    if (circle === null) return { refusal: refusal("not_found") };

    // §2.10 promises elapsed time leaves the device "only if your circle enabled
    // it", and the honest reading is that we do not persist what we promised not
    // to collect. board.js also strips `seconds` at read time; both layers stay,
    // one as the promise and one as defence in depth. Consequence for M2's copy:
    // enabling show_time does not retroactively reveal times for days recorded
    // while it was off.
    const storedSeconds = circle.showTime === true ? seconds.value : null;

    let written;
    try {
      written = await context.store.putResult({
        circleCode: resolved.code,
        memberKey: context.memberKey,
        playDate,
        attempts: attempts.value,
        besa: context.body.besa,
        hint: context.body.hint,
        seconds: storedSeconds,
      });
    } catch (error) {
      // Matched on the constant store.js exports, never on a driver code — that
      // is the whole point of the constant existing.
      if (String(error?.message ?? "").includes(FOREIGN_KEY_MESSAGE)) {
        return { refusal: refusal("not_a_member") };
      }
      throw error;
    }

    // 409 is a *success* for the offline outbox: the job is done, drop it, do
    // not retry. A client that treats it as a failure will retry forever and
    // burn the minute bucket.
    if (written === "conflict") return { refusal: refusal("result_exists") };

    // No points, no rank, no board here. The client computes the same number
    // from the same module, and a fat response would be a spoiler vector: the
    // POST completes before the player necessarily wants to see the board.
    return { status: 201, body: { playDate } };
  },

  /** 8.7 GET /api/rrethi/circles/:code/board?date= */
  async board(context) {
    const resolved = requireCode(context);
    if (resolved.refusal !== undefined) return resolved;

    const now = context.now();
    const requested = context.url.searchParams.get("date");
    const playDate = requested === null ? getTiranaDateKey(now) : normalizeDateKey(requested);
    if (playDate === null) return { refusal: refusal("invalid_date") };
    if (!isReadableDate(playDate, now)) return { refusal: refusal("date_out_of_range") };

    const gate = await requireMembership(context, resolved.code);
    if (gate.refusal !== undefined) return gate;

    const results = await context.store.listResults(resolved.code, playDate);

    // The handler performs no masking of its own: it calls buildBoard and
    // serialises what comes back. buildBoard also throws when the viewer is
    // outside the roster — that is defence in depth behind the check above, not
    // a substitute for it, so reaching it means this handler skipped its own
    // check and it must surface as a 500, never as a synthesised 403.
    const board = buildBoard({
      members: gate.members,
      results,
      viewerKey: context.memberKey,
      playDate,
      showTime: gate.circle.showTime,
      now,
    });

    return {
      status: 200,
      body: { code: gate.circle.code, playDate: board.playDate, masked: board.masked, rows: board.rows },
    };
  },

  /** 8.8 GET /api/rrethi/circles/:code/week?start= */
  async week(context) {
    const resolved = requireCode(context);
    if (resolved.refusal !== undefined) return resolved;

    const now = context.now();
    const requested = context.url.searchParams.get("start");
    const start = requested === null ? mondayOf(getTiranaDateKey(now)) : normalizeDateKey(requested);
    if (start === null) return { refusal: refusal("invalid_date") };
    // A silent snap-to-Monday would make two clients disagree about which week
    // they are looking at, so a non-Monday start is refused rather than fixed.
    if (weekdayOf(start) !== 1) return { refusal: refusal("invalid_field", "start") };
    if (!isReadableDate(start, now)) return { refusal: refusal("date_out_of_range") };

    const gate = await requireMembership(context, resolved.code);
    if (gate.refusal !== undefined) return gate;

    const startOrdinal = dateKeyOrdinal(start);
    const days = Array.from({ length: 7 }, (_, offset) => dateKeyFromOrdinal(startOrdinal + offset));
    const end = days[6];

    const rows = await context.store.listResultRange(resolved.code, start, end);
    /** @type {Map<string, Map<string, object>>} */
    const byDay = new Map();
    for (const row of rows) {
      if (!byDay.has(row.playDate)) byDay.set(row.playDate, new Map());
      byDay.get(row.playDate).set(row.memberKey, row);
    }

    // Points are invertible — `points = 7 - attempts [+1]` — so publishing a
    // day's points publishes that day's attempts. The week must therefore honour
    // exactly the board's mask, day by day, through the same shipped function.
    // Never feed listResultRange output into buildBoard: it throws on rows from
    // more than one date, deliberately, because filtering would quietly publish
    // one day's difficulty under another day's heading.
    const maskedDates = days.filter((dayKey) =>
      isBoardMasked(dayKey, byDay.get(dayKey)?.has(context.memberKey) ?? false, now),
    );
    const masked = new Set(maskedDates);

    const boardRows = gate.members.map((member) => {
      /** @type {Record<string, number>} */
      const scored = {};
      let total = 0;
      for (const dayKey of days) {
        if (masked.has(dayKey)) continue;
        const row = byDay.get(dayKey)?.get(member.memberKey);
        // An absent day and a zero-point loss are different facts, so a day with
        // no result is omitted rather than written as 0.
        if (row === undefined) continue;
        const points = weeklyPoints(row);
        scored[dayKey] = points;
        total += points;
      }
      const shaped = { displayName: member.displayName };
      if (member.memberKey === context.memberKey) shaped.you = true;
      shaped.days = scored;
      shaped.total = total;
      return shaped;
    });

    // Same collation board.js uses, so the two views never disagree about order.
    boardRows.sort(
      (left, right) =>
        right.total - left.total || left.displayName.localeCompare(right.displayName, "sq-AL"),
    );

    return {
      status: 200,
      body: { code: gate.circle.code, start, end, maskedDates, rows: boardRows },
    };
  },

  /** 8.9 DELETE /api/rrethi/me — immediate, irreversible, always 204. */
  async deleteMe(context) {
    // Cascades to memberships, the results reached through them, and the circles
    // this member owns — which cascade their own memberships and results. A
    // member who owns the family circle destroys it for everyone by deleting
    // their data; schema.sql records that decision (an FK must never block a
    // deletion request) and M2's confirmation copy must say so in plain Albanian
    // before the button is armed.
    //
    // Not erased: rate_bucket rows, which have no cascade. They hold only an
    // HMAC, expire within 24 hours, and are unlinkable to the deleted key —
    // which is precisely why the bucket key is an HMAC and not the raw key.
    //
    // No 404 for an unknown key: a repeat delete is defined as 204, and a 404
    // would confirm that a given secret was never registered.
    await context.store.deleteMember(context.memberKey);
    return { noContent: true };
  },
};

export default handleRrethiRequest;
