// The nine Rrethi endpoints — PLAN-RRETHI-M1-API.md §10.
//
// Every numbered test below carries its checklist number, and the lines the
// plan marks [M1 acceptance] are marked here too. §10's rule is that an
// implementer is done when every line is a passing test and not before.
//
// Two suite-wide invariants are enforced inside `callApi` rather than as
// individual tests, so they hold for every request any test in this file makes,
// including ones written later:
//
//   * checklist 8  — every response carries the no-store header block.
//   * checklist 12 — no error response anywhere contains a driver string.
//
// Not covered here, and deliberately not claimed as covered:
//
//   * checklist 30 (two concurrent claimSeat calls against real Postgres, 20
//     times) and 31 (direct SQL raising 23505 / 23514) live in
//     tests/rrethi-store.test.js, where the adapter matrix and the pglite
//     bridge are. The HTTP layer cannot prove a database invariant.
//   * checklist 47 (zero /api/* entries in Cache Storage after a scripted run
//     in a service-worker-controlled browser) needs a real browser. It is a
//     browser check, not a node:test one, and is listed in the M1 report as an
//     open verification gap rather than silently dropped.

import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { handleRrethiRequest } from "../api/_lib/router.js";
import { createStore } from "../api/_lib/store.js";
import { getTiranaDateKey, tiranaMidnightEpoch } from "../src/game.js";

const PEPPER = "a".repeat(64);
const OTHER_PEPPER = "b".repeat(64);
const ENV = Object.freeze({ RRETHI_API_ENABLED: "1", RRETHI_SERVER_PEPPER: PEPPER });

/** 26 Crockford characters. `suffix` must come from the same alphabet. */
function token(suffix) {
  return `ABCDEFGHJKMNPQRSTVWXYZ012${suffix}`;
}
const TOKEN_A = token("3");
const TOKEN_B = token("4");
const TOKEN_C = token("5");

const PROFILE = { displayName: "Ana", avatarId: "stick-racer", letterSeal: "ë" };

/** Substrings no error response may ever contain (checklist 12). */
const LEAK_MARKERS = ["rrethi:", "SQLSTATE", "neon", "postgres", "password", "Error:", "at "];

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function createRequest({ method = "GET", path = "/", body, token: bearer, headers = {}, chunkSize }) {
  const lower = {};
  for (const [name, value] of Object.entries(headers)) lower[name.toLowerCase()] = value;

  let payload = null;
  if (body !== undefined) {
    payload = typeof body === "string" ? body : JSON.stringify(body);
    if (lower["content-type"] === undefined) lower["content-type"] = "application/json";
  }
  if (bearer !== undefined && bearer !== null) lower.authorization = `Bearer ${bearer}`;
  if (lower.host === undefined) lower.host = "www.example.test";

  const state = { yielded: 0, destroyed: false };
  const request = {
    method,
    url: path,
    headers: lower,
    state,
    destroy() {
      state.destroyed = true;
    },
    async *[Symbol.asyncIterator]() {
      if (payload === null) return;
      const buffer = Buffer.from(payload, "utf8");
      const size = chunkSize ?? buffer.length;
      for (let offset = 0; offset < buffer.length; offset += size) {
        const chunk = buffer.subarray(offset, offset + size);
        state.yielded += chunk.length;
        yield chunk;
      }
    },
  };
  return request;
}

function createResponse() {
  const headers = new Map();
  return {
    statusCode: 200,
    text: "",
    ended: false,
    headers,
    setHeader(name, value) {
      headers.set(String(name).toLowerCase(), String(value));
    },
    end(payload) {
      this.ended = true;
      this.text = payload === undefined ? "" : String(payload);
    },
  };
}

/**
 * One request. Asserts the two suite-wide invariants on the way out, so no
 * individual test has to remember to.
 */
async function callApi(options = {}) {
  const request = createRequest(options);
  const response = createResponse();
  await handleRrethiRequest(request, response, options.env ?? ENV, {
    store: options.store,
    now: options.now,
  });

  // Checklist 8 [M1 acceptance]: on every response, including 405s and 204s.
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
  assert.ok(response.headers.has("content-length"), "every response carries Content-Length");
  assert.equal(
    Number(response.headers.get("content-length")),
    Buffer.byteLength(response.text),
    "Content-Length must match the body it describes",
  );

  const parsed = response.text === "" ? null : JSON.parse(response.text);
  if (parsed !== null && parsed.status === "error") {
    // Checklist 12: asserted on the raw text, not on a parsed object.
    for (const marker of LEAK_MARKERS) {
      assert.ok(
        !response.text.includes(marker),
        `error response leaked ${JSON.stringify(marker)}: ${response.text}`,
      );
    }
    assert.ok(!Object.hasOwn(parsed, "message"), "the error envelope has no message key, ever");
  }

  return {
    status: response.statusCode,
    headers: response.headers,
    text: response.text,
    body: parsed,
    request,
  };
}

async function freshStore() {
  return createStore({ RRETHI_STORE: "memory" });
}

/** Registers a member and returns their memberId. */
async function register(store, bearer, overrides = {}) {
  const result = await callApi({
    method: "POST",
    path: "/api/rrethi/members",
    token: bearer,
    body: { ...PROFILE, ...overrides },
    store,
  });
  assert.ok(result.status === 200 || result.status === 201, `register failed: ${result.text}`);
  return result.body.memberId;
}

/** Two registered members sharing one circle: A is the owner, B joined. */
async function twoMemberCircle(options = {}) {
  const store = options.store ?? (await freshStore());
  const keyA = await register(store, TOKEN_A, { displayName: "Ana" });
  const keyB = await register(store, TOKEN_B, { displayName: "Ben" });
  const created = await callApi({
    method: "POST",
    path: "/api/rrethi/circles",
    token: TOKEN_A,
    body: { name: "Familja" },
    store,
    now: options.now,
  });
  assert.equal(created.status, 201, created.text);
  const code = created.body.code;
  const joined = await callApi({
    method: "POST",
    path: `/api/rrethi/circles/${code}/join`,
    token: TOKEN_B,
    body: {},
    store,
    now: options.now,
  });
  assert.equal(joined.status, 201, joined.text);
  return { store, code, keyA, keyB };
}

async function postResult(store, bearer, code, result, now) {
  return callApi({
    method: "POST",
    path: `/api/rrethi/circles/${code}/results`,
    token: bearer,
    body: result,
    store,
    now,
  });
}

/** Counts every store method call, so a test can assert one was never reached. */
function countingStore(inner) {
  const calls = [];
  const proxy = {};
  for (const name of Object.keys(inner)) {
    proxy[name] = async (...args) => {
      calls.push(name);
      return inner[name](...args);
    };
  }
  return { store: proxy, calls };
}

/** Every route, for the tests that must hold across all nine. */
function everyRoute(code = "8G2K4M9P1QRTV") {
  return [
    { method: "POST", path: "/api/rrethi/members", body: PROFILE },
    { method: "POST", path: "/api/rrethi/circles", body: { name: "Familja" } },
    { method: "GET", path: `/api/rrethi/circles/${code}` },
    { method: "POST", path: `/api/rrethi/circles/${code}/join`, body: {} },
    { method: "DELETE", path: `/api/rrethi/circles/${code}/members/me` },
    {
      method: "POST",
      path: `/api/rrethi/circles/${code}/results`,
      body: { date: "2026-08-07", attempts: 3, besa: false, hint: false },
    },
    { method: "GET", path: `/api/rrethi/circles/${code}/board` },
    { method: "GET", path: `/api/rrethi/circles/${code}/week` },
    { method: "DELETE", path: "/api/rrethi/me" },
  ];
}

/** A clock pinned to an exact offset from a Tirana midnight. */
function clockAt(dateKey, offsetMs) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const instant = tiranaMidnightEpoch(year, month, day) + offsetMs;
  return () => new Date(instant);
}

// ---------------------------------------------------------------------------
// The server gate (§11, O6)
// ---------------------------------------------------------------------------

test("the server gate answers 404 for every route and spends nothing", async () => {
  const { store, calls } = countingStore(await freshStore());
  for (const route of everyRoute()) {
    const result = await callApi({
      ...route,
      token: TOKEN_A,
      store,
      env: { RRETHI_SERVER_PEPPER: PEPPER },
    });
    assert.equal(result.status, 404);
    assert.equal(result.body.error, "not_found");
  }
  // A disabled service must not write rate_bucket rows while switched off.
  assert.deepEqual(calls, []);
});

// ---------------------------------------------------------------------------
// Auth (checklist 1–7)
// ---------------------------------------------------------------------------

test("1. a missing Authorization header is 401 and says nothing else", async () => {
  const store = await freshStore();
  const result = await callApi({ method: "GET", path: "/api/rrethi/circles/8G2K4M9P1QRTV", store });
  assert.equal(result.status, 401);
  assert.deepEqual(Object.keys(result.body).sort(), ["error", "status"]);
  assert.equal(result.body.error, "unauthorized");
});

test("2. a non-canonical bearer is 401 and reaches no member or circle method", async () => {
  const malformed = [
    "ABCDEFGHJKMNPQRSTVWXYZ01", // 25
    "ABCDEFGHJKMNPQRSTVWXYZ0123", // 26 — the control, must NOT be in this list
    "abcdefghjkmnpqrstvwxyz0123", // lowercase
    "ABCDEFGHJKMNPQRSTVWXYZ012I", // I is not in Crockford's alphabet
    "ABCDEFGHJKMNPQRSTVWXYZ012L",
    "ABCDEFGHJKMNPQRSTVWXYZ012O",
    "ABCDEFGHJKMNPQRSTVWXYZ012U",
    "ABCDEFGHJKMNPQRSTVWXYZ01234", // 27
  ];
  for (const bearer of malformed.filter((value) => value !== "ABCDEFGHJKMNPQRSTVWXYZ0123")) {
    const { store, calls } = countingStore(await freshStore());
    const result = await callApi({ method: "GET", path: "/api/rrethi/circles/8G2K4M9P1QRTV", token: bearer, store });
    assert.equal(result.status, 401, `expected 401 for ${bearer}`);
    assert.equal(result.body.error, "unauthorized");
    // §10's line reads "no store method is called". §3.2 requires the anonymous
    // bucket to be charged for exactly these requests (checklist 40 asserts it),
    // so the assertion that is actually true — and the one that matters — is
    // that nothing identity-bearing was touched.
    assert.deepEqual([...new Set(calls)], ["takeToken"]);
  }
});

test("3. a well-formed bearer with no row is 401 unknown_member on 2–8, 201 on 1", async () => {
  const store = await freshStore();
  const routes = everyRoute();
  const members = routes[0];
  // §10's line reads "endpoints 2–9", but endpoint 9 is DELETE /api/rrethi/me,
  // which §8.9 and the §9 summary table both define as needing no member row
  // and always answering 204 — a 401 there would confirm that a given secret was
  // never registered, which is exactly what §8.9 refuses to do. Endpoints 2–8
  // are the ones that require a row; 3b below pins endpoint 9's behaviour.
  for (const route of routes.slice(1, 8)) {
    const result = await callApi({ ...route, token: TOKEN_C, store });
    assert.equal(result.status, 401, `${route.method} ${route.path}: ${result.text}`);
    assert.equal(result.body.error, "unknown_member");
  }
  const created = await callApi({ ...members, token: TOKEN_C, store });
  assert.equal(created.status, 201);
});

test("3b. DELETE /me needs no row and is 204 for an unregistered secret", async () => {
  // §8.9: no getMember first, and no 404 — a 404 would confirm that a given
  // secret was never registered.
  const store = await freshStore();
  const result = await callApi({ method: "DELETE", path: "/api/rrethi/me", token: TOKEN_C, store });
  assert.equal(result.status, 204);
  assert.equal(result.text, "");
});

test("4. memberId is a stable one-way function of the secret", async () => {
  const first = await freshStore();
  const second = await freshStore();
  const a1 = await register(first, TOKEN_A);
  const b1 = await register(first, TOKEN_B);
  assert.notEqual(a1, b1);
  assert.match(a1, /^[0-9a-f]{64}$/u);

  // The same secret in a different process with the same pepper: same id.
  const a2 = await register(second, TOKEN_A);
  assert.equal(a2, a1);
  // And it is not the secret, nor derivable from the response.
  assert.ok(!a1.includes(TOKEN_A.toLowerCase()));
});

test("5. rotating the pepper orphans the row irreversibly", async () => {
  const store = await freshStore();
  const before = await register(store, TOKEN_A);
  const after = await callApi({
    method: "POST",
    path: "/api/rrethi/members",
    token: TOKEN_A,
    body: PROFILE,
    store,
    env: { RRETHI_API_ENABLED: "1", RRETHI_SERVER_PEPPER: OTHER_PEPPER },
  });
  assert.notEqual(after.body.memberId, before);
  // 201, not 200: under the new pepper this is a member the server has never
  // seen. That is the documented, intended cost of rotation.
  assert.equal(after.status, 201);
});

test("6. a missing or malformed pepper is 503 on all nine, with no store call", async () => {
  for (const pepper of [undefined, "f".repeat(63), "", "z".repeat(64)]) {
    const { store, calls } = countingStore(await freshStore());
    for (const route of everyRoute()) {
      const result = await callApi({
        ...route,
        token: TOKEN_A,
        store,
        env: { RRETHI_API_ENABLED: "1", RRETHI_SERVER_PEPPER: pepper },
      });
      assert.equal(result.status, 503, `${route.method} ${route.path}`);
      assert.equal(result.body.error, "not_configured");
    }
    assert.deepEqual(calls, []);
  }
});

test("7. [M1 acceptance] a full scripted run logs no secret, key or circle code", async () => {
  const captured = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args) => captured.push(args.map(String).join(" "));
  console.error = (...args) => captured.push(args.map(String).join(" "));

  let code;
  let keyA;
  let keyB;
  try {
    const scenario = await twoMemberCircle();
    ({ code, keyA, keyB } = scenario);
    const today = getTiranaDateKey(new Date());
    await postResult(scenario.store, TOKEN_A, code, {
      date: today,
      attempts: 3,
      besa: true,
      hint: false,
    });
    await callApi({ method: "GET", path: `/api/rrethi/circles/${code}/board`, token: TOKEN_B, store: scenario.store });
    await callApi({ method: "GET", path: `/api/rrethi/circles/${code}/week`, token: TOKEN_A, store: scenario.store });
    await callApi({ method: "DELETE", path: `/api/rrethi/circles/${code}/members/me`, token: TOKEN_B, store: scenario.store });
    await callApi({ method: "DELETE", path: "/api/rrethi/me", token: TOKEN_A, store: scenario.store });
    // An adapter failure is the one path that logs at all; include it.
    const broken = { ...(await freshStore()), getMember: async () => { throw new Error("rrethi: database error"); } };
    await callApi({ method: "GET", path: `/api/rrethi/circles/${code}`, token: TOKEN_A, store: broken });
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }

  const transcript = captured.join("\n");
  for (const secret of [TOKEN_A, TOKEN_B, keyA, keyB, code]) {
    assert.ok(!transcript.includes(secret), `log leaked ${secret}: ${transcript}`);
  }
  // Whatever was logged carries only the bounded pair health.js logs.
  for (const line of captured) {
    assert.match(line, /^rrethi: [a-z ]+ \[object Object\]$|^rrethi: [a-z ]+ \{/u);
  }
});

// ---------------------------------------------------------------------------
// Envelope (checklist 9–13); 8 and 12 are enforced in callApi for every request
// ---------------------------------------------------------------------------

test("9. [M1 acceptance] a wrong verb is 405 with an exact Allow list, and OPTIONS is 405", async () => {
  const store = await freshStore();
  const cases = [
    { method: "GET", path: "/api/rrethi/members", allow: "POST" },
    { method: "OPTIONS", path: "/api/rrethi/members", allow: "POST" },
    { method: "GET", path: "/api/rrethi/me", allow: "DELETE" },
    { method: "OPTIONS", path: "/api/rrethi/circles/8G2K4M9P1QRTV/board", allow: "GET" },
    { method: "PUT", path: "/api/rrethi/circles/8G2K4M9P1QRTV/results", allow: "POST" },
    { method: "POST", path: "/api/rrethi/circles/8G2K4M9P1QRTV/members/me", allow: "DELETE" },
  ];
  for (const { method, path, allow } of cases) {
    const result = await callApi({ method, path, token: TOKEN_A, store });
    assert.equal(result.status, 405, `${method} ${path}`);
    assert.equal(result.body.error, "method_not_allowed");
    assert.equal(result.headers.get("allow"), allow);
  }
});

test("10. a wrong content type is 415, and an oversized body is 413 without being buffered", async () => {
  const store = await freshStore();

  const wrongType = await callApi({
    method: "POST",
    path: "/api/rrethi/members",
    token: TOKEN_A,
    body: JSON.stringify(PROFILE),
    headers: { "content-type": "text/plain" },
    store,
  });
  assert.equal(wrongType.status, 415);
  assert.equal(wrongType.body.error, "unsupported_media_type");

  // charset=utf-8 is explicitly allowed.
  const charset = await callApi({
    method: "POST",
    path: "/api/rrethi/members",
    token: TOKEN_A,
    body: JSON.stringify(PROFILE),
    headers: { "content-type": "application/json; charset=utf-8" },
    store,
  });
  assert.equal(charset.status, 201);

  // Exactly one byte over the cap.
  const overCap = JSON.stringify({ displayName: "Ana", pad: "x".repeat(2100) });
  const tooBig = await callApi({ method: "POST", path: "/api/rrethi/members", token: TOKEN_A, body: overCap, store });
  assert.equal(tooBig.status, 413);
  assert.equal(tooBig.body.error, "payload_too_large");

  // The stream is abandoned rather than drained: a 100 KiB body delivered in
  // 1 KiB chunks stops being pulled once the cumulative size passes the cap.
  const huge = JSON.stringify({ displayName: "Ana", pad: "x".repeat(100_000) });
  const abandoned = await callApi({
    method: "POST",
    path: "/api/rrethi/members",
    token: TOKEN_A,
    body: huge,
    chunkSize: 1024,
    headers: { "content-length": "" },
    store,
  });
  assert.equal(abandoned.status, 413);
  assert.ok(
    abandoned.request.state.yielded <= 3 * 1024,
    `read ${abandoned.request.state.yielded} bytes of a 100 KiB body; the cap is 2048`,
  );
  assert.equal(abandoned.request.state.destroyed, true);
});

test("11. [M1 acceptance] a cross-origin mutation is 403 before any store call", async () => {
  const { store, calls } = countingStore(await freshStore());
  for (const route of everyRoute().filter((r) => r.method !== "GET")) {
    const result = await callApi({
      ...route,
      token: TOKEN_A,
      headers: { origin: "https://evil.example", host: "www.example.test" },
      store,
    });
    assert.equal(result.status, 403, `${route.method} ${route.path}`);
    assert.equal(result.body.error, "forbidden_origin");
  }
  assert.deepEqual(calls, []);

  // The deployment's own origin is derived from the request, so previews work
  // with no env var — and an absent Origin (curl, the acceptance script) passes.
  const sameOrigin = await callApi({
    method: "POST",
    path: "/api/rrethi/members",
    token: TOKEN_A,
    body: PROFILE,
    headers: { origin: "https://www.example.test", host: "www.example.test" },
    store: await freshStore(),
  });
  assert.equal(sameOrigin.status, 201);
});

test("11b. the origin check derives the scheme from the connection, not a hard https default", async () => {
  // Found in a real service-worker-controlled browser, not by a test: with the
  // scheme hard-defaulted to https, a page served over plain http derives
  // `https://localhost:4174` while the browser sends `Origin:
  // http://localhost:4174`, so EVERY same-origin browser POST is a 403. It is
  // invisible on Vercel (which always sets x-forwarded-proto) and invisible to
  // both this harness and node's fetch, neither of which sends Origin on a
  // same-origin request. It would have ambushed M2's first UI POST.
  const post = async (headers, socket) => {
    const request = createRequest({
      method: "POST",
      path: "/api/rrethi/members",
      token: TOKEN_A,
      body: PROFILE,
      headers,
    });
    if (socket !== undefined) request.socket = socket;
    const response = createResponse();
    await handleRrethiRequest(request, response, ENV, { store: await freshStore() });
    return response.statusCode;
  };

  const plain = { host: "localhost:4174" };
  // An unencrypted connection: the http origin is this deployment's own.
  assert.equal(await post({ ...plain, origin: "http://localhost:4174" }, { encrypted: false }), 201);
  assert.equal(await post({ ...plain, origin: "https://localhost:4174" }, { encrypted: false }), 403);
  // A TLS connection with no proxy header.
  assert.equal(await post({ ...plain, origin: "https://localhost:4174" }, { encrypted: true }), 201);
  assert.equal(await post({ ...plain, origin: "http://localhost:4174" }, { encrypted: true }), 403);
  // The production path: the proxy header wins over the socket, and a chain
  // keeps its client-facing hop.
  const proxied = { host: "www.example.test", "x-forwarded-proto": "https" };
  assert.equal(await post({ ...proxied, origin: "https://www.example.test" }, { encrypted: false }), 201);
  assert.equal(await post({ ...proxied, origin: "http://www.example.test" }, { encrypted: false }), 403);
  assert.equal(
    await post(
      { host: "www.example.test", "x-forwarded-proto": "https, http", origin: "https://www.example.test" },
      { encrypted: false },
    ),
    201,
  );
  // With no socket at all, §1's documented https default still stands.
  assert.equal(await post({ host: "www.example.test", origin: "https://www.example.test" }), 201);
});

test("13. an adapter throw is 500 with a bounded log line and no detail on the wire", async () => {
  const inner = await freshStore();
  const store = {
    ...inner,
    getMember: async () => {
      const error = new Error("rrethi: database error");
      error.cause = new Error("connect ECONNREFUSED postgres://user:password@host/db");
      error.code = "ECONNREFUSED";
      return Promise.reject(error);
    },
  };
  const captured = [];
  const originalError = console.error;
  console.error = (...args) => captured.push(args);
  let result;
  try {
    result = await callApi({ method: "GET", path: "/api/rrethi/circles/8G2K4M9P1QRTV", token: TOKEN_A, store });
  } finally {
    console.error = originalError;
  }
  assert.equal(result.status, 500);
  assert.equal(result.body.error, "server_error");
  assert.equal(captured.length, 1);
  assert.deepEqual(Object.keys(captured[0][1]).sort(), ["code", "name"]);
  assert.deepEqual(captured[0][1], { name: "Error", code: "ECONNREFUSED" });
  // The cause — which embeds the connection URL — is never serialised.
  assert.ok(!JSON.stringify(captured[0]).includes("password"));
});

// ---------------------------------------------------------------------------
// Validation (checklist 14–19)
// ---------------------------------------------------------------------------

test("14. [M1 acceptance] displayName bounds, control characters and emoji", async () => {
  const store = await freshStore();
  const reject = async (displayName) => {
    const result = await callApi({
      method: "POST",
      path: "/api/rrethi/members",
      token: TOKEN_A,
      body: { ...PROFILE, displayName },
      store,
    });
    assert.equal(result.status, 400, `expected 400 for ${JSON.stringify(displayName)}`);
    assert.equal(result.body.error, "invalid_field");
    assert.equal(result.body.field, "displayName");
  };

  await reject("A"); // 1 code point
  await reject("A".repeat(21)); // 21 code points
  await reject("Ana"); // a literal BEL
  await reject("😀😀😀"); // three emoji
  await reject(42);
  await reject(null);
  await reject(undefined);

  const accept = async (displayName) => {
    const result = await callApi({
      method: "POST",
      path: "/api/rrethi/members",
      token: TOKEN_A,
      body: { ...PROFILE, displayName },
      store,
    });
    assert.ok(result.status === 200 || result.status === 201, `expected ok for ${displayName}: ${result.text}`);
    return result.body.displayName;
  };
  assert.equal(await accept("A".repeat(20)), "A".repeat(20)); // 20 passes
  await accept("😀😀"); // two emoji pass
  assert.equal(await accept("  Ana  "), "Ana"); // trimmed before measuring
});

test("15. the avatar catalog and the 36-letter alphabet are the referees", async () => {
  const { AVATAR_IDS } = await import("../src/avatars.js");
  const { ALBANIAN_ALPHABET } = await import("../src/game.js");
  // 24 + 36 + the rejections is more than the 60/minute allowance, so each group
  // gets its own store rather than letting the limiter mask a validation bug.
  let store = await freshStore();

  for (const avatarId of AVATAR_IDS) {
    const result = await callApi({
      method: "POST",
      path: "/api/rrethi/members",
      token: TOKEN_A,
      body: { ...PROFILE, avatarId },
      store,
    });
    assert.ok(result.status === 200 || result.status === 201, `${avatarId}: ${result.text}`);
    assert.equal(result.body.avatarId, avatarId);
  }
  assert.equal(AVATAR_IDS.length, 24);

  store = await freshStore();
  for (const letterSeal of ALBANIAN_ALPHABET) {
    const result = await callApi({
      method: "POST",
      path: "/api/rrethi/members",
      token: TOKEN_A,
      body: { ...PROFILE, letterSeal },
      store,
    });
    assert.ok(result.status === 200 || result.status === 201, `${letterSeal}: ${result.text}`);
    assert.equal(result.body.letterSeal, letterSeal);
  }
  assert.equal(ALBANIAN_ALPHABET.length, 36);

  store = await freshStore();
  for (const [field, body] of [
    ["avatarId", { ...PROFILE, avatarId: "animal-unicorn" }],
    ["avatarId", { ...PROFILE, avatarId: 7 }],
    ["letterSeal", { ...PROFILE, letterSeal: "w" }],
    ["letterSeal", { ...PROFILE, letterSeal: "dh " }],
  ]) {
    const result = await callApi({ method: "POST", path: "/api/rrethi/members", token: TOKEN_A, body, store });
    if (field === "letterSeal" && body.letterSeal === "dh ") {
      // normalizeWord trims, so this one is legitimately accepted.
      assert.ok(result.status === 200 || result.status === 201);
      continue;
    }
    assert.equal(result.status, 400);
    assert.equal(result.body.field, field);
  }
});

test("16. attempts accepts 1..6 and \"X\", and \"X\" is stored as null", async () => {
  const { store, code } = await twoMemberCircle();
  const today = getTiranaDateKey(new Date());

  for (const attempts of [0, 7, "3", null, 3.5, "x", true]) {
    const result = await postResult(store, TOKEN_A, code, { date: today, attempts, besa: false, hint: false });
    assert.equal(result.status, 400, `expected 400 for attempts ${JSON.stringify(attempts)}`);
    assert.equal(result.body.field, "attempts");
  }

  const loss = await postResult(store, TOKEN_A, code, { date: today, attempts: "X", besa: false, hint: false });
  assert.equal(loss.status, 201);
  const stored = await store.listResults(code, today);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].attempts, null);

  const win = await postResult(store, TOKEN_B, code, { date: today, attempts: 1, besa: false, hint: false });
  assert.equal(win.status, 201);
});

test("17. besa and hint are strict booleans; seconds is a bounded integer", async () => {
  const { store, code } = await twoMemberCircle();
  const today = getTiranaDateKey(new Date());
  const base = { date: today, attempts: 3, besa: false, hint: false };

  for (const [field, patch] of [
    ["besa", { besa: "true" }],
    ["besa", { besa: 1 }],
    ["hint", { hint: 0 }],
    ["hint", { hint: null }],
    ["seconds", { seconds: -1 }],
    ["seconds", { seconds: 2_147_483_648 }],
    ["seconds", { seconds: "12" }],
    ["seconds", { seconds: 1.5 }],
  ]) {
    const result = await postResult(store, TOKEN_A, code, { ...base, ...patch });
    assert.equal(result.status, 400, `${field} ${JSON.stringify(patch)}`);
    assert.equal(result.body.field, field);
  }

  // seconds is optional, and null reads as absent.
  const ok = await postResult(store, TOKEN_A, code, { ...base, seconds: null });
  assert.equal(ok.status, 201);
});

test("18. [M1 acceptance] an impossible calendar date is invalid_date", async () => {
  const { store, code } = await twoMemberCircle();
  for (const date of ["2026-02-30", "2026-13-01", "2026-08-32", "20260807", "2026-8-7", 20260807]) {
    const result = await postResult(store, TOKEN_A, code, { date, attempts: 3, besa: false, hint: false });
    assert.equal(result.status, 400, `expected 400 for ${date}`);
    assert.equal(result.body.error, "invalid_date");
  }
  const board = await callApi({
    method: "GET",
    path: `/api/rrethi/circles/${code}/board?date=2026-02-30`,
    token: TOKEN_A,
    store,
  });
  assert.equal(board.status, 400);
  assert.equal(board.body.error, "invalid_date");
});

test("19. [M1 acceptance] week?start must be a Monday, and the store guards the range", async () => {
  const { store, code } = await twoMemberCircle();

  const tuesday = await callApi({
    method: "GET",
    path: `/api/rrethi/circles/${code}/week?start=2026-08-04`,
    token: TOKEN_A,
    store,
  });
  assert.equal(tuesday.status, 400);
  assert.equal(tuesday.body.error, "invalid_field");
  assert.equal(tuesday.body.field, "start");

  const monday = await callApi({
    method: "GET",
    path: `/api/rrethi/circles/${code}/week?start=2026-08-03`,
    token: TOKEN_A,
    store,
  });
  assert.equal(monday.status, 200);
  assert.equal(monday.body.start, "2026-08-03");
  assert.equal(monday.body.end, "2026-08-09");

  // A reversed or over-long range cannot be built through the API — the handler
  // always derives `end` from `start` — so listResultRange's own guard is
  // asserted directly instead.
  await assert.rejects(
    () => store.listResultRange(code, "2026-08-09", "2026-08-03"),
    /from must be on or before to/u,
  );
  await assert.rejects(
    () => store.listResultRange(code, "2020-01-01", "2026-01-01"),
    /range must span at most 366 days/u,
  );
});

// ---------------------------------------------------------------------------
// Spoiler (checklist 20–24b)
// ---------------------------------------------------------------------------

test("20. [M1 acceptance] a board fetched before finishing never contains \"attempts\"", async () => {
  const { store, code } = await twoMemberCircle();
  const today = getTiranaDateKey(new Date());
  const posted = await postResult(store, TOKEN_A, code, { date: today, attempts: 2, besa: true, hint: false });
  assert.equal(posted.status, 201);

  const board = await callApi({ method: "GET", path: `/api/rrethi/circles/${code}/board`, token: TOKEN_B, store });
  assert.equal(board.status, 200);
  assert.equal(board.body.masked, true);
  // Asserted on the raw response text, not on a parsed object.
  assert.ok(!board.text.includes("attempts"), board.text);
});

test("21. the same masked board also lacks points, besa, hint and seconds", async () => {
  const { store, code } = await twoMemberCircle();
  const today = getTiranaDateKey(new Date());
  await postResult(store, TOKEN_A, code, { date: today, attempts: 2, besa: true, hint: true, seconds: 91 });

  const board = await callApi({ method: "GET", path: `/api/rrethi/circles/${code}/board`, token: TOKEN_B, store });
  for (const key of ["attempts", "points", "besa", "hint", "seconds"]) {
    assert.ok(!board.text.includes(key), `masked board leaked ${key}: ${board.text}`);
  }
  // A masked row is displayName + finished, plus `you` on the viewer's own row —
  // `you` is self-referential and leaks nothing about anyone else.
  const mine = board.body.rows.find((row) => row.you === true);
  assert.deepEqual(Object.keys(mine).sort(), ["displayName", "finished", "you"]);
  assert.equal(mine.finished, false);
  assert.equal(board.body.rows.find((row) => row.displayName === "Ana").finished, true);
});

test("22. once the viewer posts, the board unmasks, sorts best-first and marks their row", async () => {
  const { store, code } = await twoMemberCircle();
  const today = getTiranaDateKey(new Date());
  await postResult(store, TOKEN_A, code, { date: today, attempts: 4, besa: false, hint: false });
  await postResult(store, TOKEN_B, code, { date: today, attempts: 2, besa: true, hint: false });

  const board = await callApi({ method: "GET", path: `/api/rrethi/circles/${code}/board`, token: TOKEN_B, store });
  assert.equal(board.body.masked, false);
  assert.deepEqual(board.body.rows.map((row) => row.displayName), ["Ben", "Ana"]);
  assert.equal(board.body.rows[0].you, true);
  assert.equal(board.body.rows[0].attempts, 2);
  assert.equal(board.body.rows[0].points, 6); // 7 - 2 + 1 for a hintless besa
  assert.equal(board.body.rows[1].points, 3); // 7 - 4
  // M1 sends no streaks argument, so no streak key appears (§11, O4). Nor any
  // avatar (O2), nor any member key anywhere.
  assert.ok(!board.text.includes("streak"));
  assert.ok(!board.text.includes("avatar"));
  assert.ok(!board.text.includes("memberKey"));
  // show_time is FALSE for every circle in M1, so seconds never appears.
  assert.ok(!board.text.includes("seconds"));
});

test("23. yesterday is masked until the viewer posts it, and reveals once it is two days old", async () => {
  // The widened mask of deviation D5: the archive keeps yesterday's word one tap
  // away, so revealing yesterday's board spoils a game the viewer can still play.
  const { store, code } = await twoMemberCircle();
  const day = "2026-08-06";
  const inGrace = clockAt("2026-08-07", 60_000); // 00:01 the next Tirana day

  await postResult(store, TOKEN_A, code, { date: day, attempts: 3, besa: false, hint: false }, inGrace);

  const masked = await callApi({
    method: "GET",
    path: `/api/rrethi/circles/${code}/board?date=${day}`,
    token: TOKEN_B,
    store,
    now: inGrace,
  });
  assert.equal(masked.body.masked, true);
  assert.ok(!masked.text.includes("attempts"));

  // B posts yesterday inside the 6-hour grace and it unmasks for B immediately.
  await postResult(store, TOKEN_B, code, { date: day, attempts: 5, besa: false, hint: false }, inGrace);
  const unmasked = await callApi({
    method: "GET",
    path: `/api/rrethi/circles/${code}/board?date=${day}`,
    token: TOKEN_B,
    store,
    now: inGrace,
  });
  assert.equal(unmasked.body.masked, false);

  // Two days on, the day reveals for everyone: it can never acquire a result
  // row again, so masking it would be masking forever.
  const later = clockAt("2026-08-08", 60_000);
  const revealed = await callApi({
    method: "GET",
    path: `/api/rrethi/circles/${code}/board?date=${day}`,
    token: TOKEN_C,
    store,
    now: later,
  });
  // TOKEN_C is not a member, so prove the reveal with a member who never posted.
  assert.equal(revealed.status, 401);
  const revealedForMember = await callApi({
    method: "GET",
    path: `/api/rrethi/circles/${code}/board?date=2026-08-07`,
    token: TOKEN_A,
    store,
    now: clockAt("2026-08-09", 60_000),
  });
  assert.equal(revealedForMember.body.masked, false);
});

test("24. the week honours the board's mask day by day and never scores a hidden day", async () => {
  const { store, code, keyA } = await twoMemberCircle();
  const now = clockAt("2026-08-06", 12 * 3_600_000); // a Thursday, 12:00 Tirana
  const monday = "2026-08-03";

  const days = ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06"];
  for (const day of days) {
    // Backdate directly through the store: the write window only reaches two
    // days, and this test is about the read path. The key is named explicitly
    // rather than taken as listMembers()[0] — Ana and Ben can join inside the
    // same millisecond, and that tie breaks by member key, so roster order is
    // not a reliable way to say "Ana".
    await store.putResult({
      circleCode: code,
      memberKey: keyA,
      playDate: day,
      attempts: 3,
      besa: false,
      hint: false,
      seconds: null,
    });
  }

  const viewerUnfinished = await callApi({
    method: "GET",
    path: `/api/rrethi/circles/${code}/week?start=${monday}`,
    token: TOKEN_B,
    store,
    now,
  });
  assert.equal(viewerUnfinished.status, 200);
  // Today (08-06) and yesterday (08-05) are hidden from B, who finished neither.
  assert.deepEqual(viewerUnfinished.body.maskedDates, ["2026-08-05", "2026-08-06"]);
  for (const row of viewerUnfinished.body.rows) {
    for (const hidden of viewerUnfinished.body.maskedDates) {
      assert.ok(!Object.hasOwn(row.days, hidden), `row leaked ${hidden}`);
    }
    const sum = Object.values(row.days).reduce((total, points) => total + points, 0);
    assert.equal(row.total, sum, "total must be the sum of the visible days only");
  }
  const anaBefore = viewerUnfinished.body.rows.find((row) => row.displayName === "Ana");
  assert.equal(anaBefore.total, 8); // two visible wins in 3 => 4 + 4

  // B finishes today: the mask drops to yesterday alone and every total grows by
  // exactly today's weeklyPoints.
  await postResult(store, TOKEN_B, code, { date: "2026-08-06", attempts: 6, besa: false, hint: false }, now);
  const viewerFinished = await callApi({
    method: "GET",
    path: `/api/rrethi/circles/${code}/week?start=${monday}`,
    token: TOKEN_B,
    store,
    now,
  });
  assert.deepEqual(viewerFinished.body.maskedDates, ["2026-08-05"]);
  const anaAfter = viewerFinished.body.rows.find((row) => row.displayName === "Ana");
  assert.equal(anaAfter.total, anaBefore.total + 4); // Ana's 08-06 win in 3
  const ben = viewerFinished.body.rows.find((row) => row.displayName === "Ben");
  assert.equal(ben.you, true);
  assert.equal(ben.days["2026-08-06"], 1); // 7 - 6

  // A fully past week hides nothing.
  const pastWeek = await callApi({
    method: "GET",
    path: `/api/rrethi/circles/${code}/week?start=2026-07-27`,
    token: TOKEN_B,
    store,
    now,
  });
  assert.deepEqual(pastWeek.body.maskedDates, []);
});

test("24b. buildBoard refuses a multi-day range, which is why the week groups by day", async () => {
  const { buildBoard } = await import("../api/_lib/board.js");
  const members = [{ memberKey: "k1", displayName: "Ana" }];
  const rows = [
    { memberKey: "k1", playDate: "2026-08-03", attempts: 3, besa: false, hint: false, seconds: null },
    { memberKey: "k1", playDate: "2026-08-04", attempts: 2, besa: false, hint: false, seconds: null },
  ];
  assert.throws(
    () => buildBoard({ members, results: rows, viewerKey: "k1", playDate: "2026-08-03" }),
    /results must all belong to playDate/u,
  );
});

// ---------------------------------------------------------------------------
// Boundaries, on a fake clock (checklist 25–29)
// ---------------------------------------------------------------------------

const BOUNDARY_DAYS = [
  { label: "an ordinary day", day: "2026-08-07" },
  // Both DST transitions in Europe/Tirane: clocks jump 02:00 -> 03:00 on the
  // last Sunday of March and 03:00 -> 02:00 on the last Sunday of October.
  { label: "the day before spring forward", day: "2026-03-28" },
  { label: "spring forward", day: "2026-03-29" },
  { label: "the day before fall back", day: "2026-10-24" },
  { label: "fall back", day: "2026-10-25" },
];

for (const { label, day } of BOUNDARY_DAYS) {
  test(`25/26. [M1 acceptance] midnight files the right date on ${label} (${day})`, async () => {
    const { store, code } = await twoMemberCircle();
    const nextDay = getTiranaDateKey(new Date(clockAt(day, 0)().getTime() + 25 * 3_600_000));

    // 23:59:30 local: 30 seconds before the next day's midnight instant.
    const beforeMidnight = clockAt(nextDay, -30_000);
    const filedToday = await postResult(
      store,
      TOKEN_A,
      code,
      { date: day, attempts: 3, besa: false, hint: false },
      beforeMidnight,
    );
    assert.equal(filedToday.status, 201, filedToday.text);
    assert.equal(filedToday.body.playDate, day);
    assert.equal(getTiranaDateKey(beforeMidnight()), day);

    // 00:00:30 local the next day.
    const afterMidnight = clockAt(nextDay, 30_000);
    assert.equal(getTiranaDateKey(afterMidnight()), nextDay);
    const filedTomorrow = await postResult(
      store,
      TOKEN_B,
      code,
      { date: nextDay, attempts: 4, besa: false, hint: false },
      afterMidnight,
    );
    assert.equal(filedTomorrow.status, 201, filedTomorrow.text);
    assert.equal(filedTomorrow.body.playDate, nextDay);

    // The D board at 00:00:30 is fully unmasked for a viewer holding a D result
    // — the member who posted at 23:59:30. Plan §2.12's unqualified phrasing
    // predates deviation D5.
    const holder = await callApi({
      method: "GET",
      path: `/api/rrethi/circles/${code}/board?date=${day}`,
      token: TOKEN_A,
      store,
      now: afterMidnight,
    });
    assert.equal(holder.body.masked, false, "a D-result holder sees D unmasked");

    // A viewer with neither a D nor a D+1 result still sees D masked: at
    // 00:00:30, D is "yesterday" and D5's widened window applies.
    const bystander = await callApi({
      method: "GET",
      path: `/api/rrethi/circles/${code}/board?date=${day}`,
      token: TOKEN_B,
      store,
      now: afterMidnight,
    });
    assert.equal(bystander.body.masked, true, "a viewer with no D result still sees D masked");
    assert.ok(!bystander.text.includes("attempts"));
  });

  test(`27. the 6-hour grace opens and closes on elapsed time on ${label} (${day})`, async () => {
    const { store, code } = await twoMemberCircle();
    const nextDay = getTiranaDateKey(new Date(clockAt(day, 0)().getTime() + 25 * 3_600_000));

    // 5h59m after the exact midnight instant: yesterday is still writable.
    const inGrace = clockAt(nextDay, 5 * 3_600_000 + 59 * 60_000);
    const accepted = await postResult(
      store,
      TOKEN_A,
      code,
      { date: day, attempts: 3, besa: false, hint: false },
      inGrace,
    );
    assert.equal(accepted.status, 201, accepted.text);

    // Six hours plus one millisecond: closed, and it never reopens.
    const closed = clockAt(nextDay, 6 * 3_600_000 + 1);
    const refused = await postResult(
      store,
      TOKEN_B,
      code,
      { date: day, attempts: 3, besa: false, hint: false },
      closed,
    );
    assert.equal(refused.status, 400);
    assert.equal(refused.body.error, "date_out_of_range");
  });
}

test("28. a result for D-2 or D+1 is out of range", async () => {
  const { store, code } = await twoMemberCircle();
  const now = clockAt("2026-08-07", 12 * 3_600_000);
  for (const date of ["2026-08-05", "2026-08-08", "2026-09-01", "2025-08-07"]) {
    const result = await postResult(store, TOKEN_A, code, { date, attempts: 3, besa: false, hint: false }, now);
    assert.equal(result.status, 400, `expected 400 for ${date}`);
    assert.equal(result.body.error, "date_out_of_range");
  }
});

test("29. the board reads back 400 days and no further", async () => {
  const { store, code } = await twoMemberCircle();
  const today = "2026-08-07";
  const now = clockAt(today, 12 * 3_600_000);
  const { dateKeyFromOrdinal, dateKeyOrdinal } = await import("../src/game.js");
  const ordinal = dateKeyOrdinal(today);

  const tooOld = await callApi({
    method: "GET",
    path: `/api/rrethi/circles/${code}/board?date=${dateKeyFromOrdinal(ordinal - 401)}`,
    token: TOKEN_A,
    store,
    now,
  });
  assert.equal(tooOld.status, 400);
  assert.equal(tooOld.body.error, "date_out_of_range");

  const inRange = await callApi({
    method: "GET",
    path: `/api/rrethi/circles/${code}/board?date=${dateKeyFromOrdinal(ordinal - 399)}`,
    token: TOKEN_A,
    store,
    now,
  });
  assert.equal(inRange.status, 200);

  const future = await callApi({
    method: "GET",
    path: `/api/rrethi/circles/${code}/board?date=${dateKeyFromOrdinal(ordinal + 1)}`,
    token: TOKEN_A,
    store,
    now,
  });
  assert.equal(future.status, 400);
  assert.equal(future.body.error, "date_out_of_range");
});

// ---------------------------------------------------------------------------
// Seats and caps (checklist 32–34; 30, 31 and 35 are in rrethi-store.test.js)
// ---------------------------------------------------------------------------

test("32. an eleventh join is 409 circle_full and the roster stays at 10", async () => {
  const store = await freshStore();
  await register(store, TOKEN_A, { displayName: "Ana" });
  const created = await callApi({
    method: "POST",
    path: "/api/rrethi/circles",
    token: TOKEN_A,
    body: { name: "Familja" },
    store,
  });
  const code = created.body.code;

  // Nine more members fill the circle; the creator already holds seat 1.
  const joiners = "6789BCDEF".split("");
  for (const suffix of joiners) {
    const bearer = token(suffix);
    await register(store, bearer, { displayName: `Anëtar${suffix}` });
    const joined = await callApi({
      method: "POST",
      path: `/api/rrethi/circles/${code}/join`,
      token: bearer,
      body: {},
      store,
    });
    assert.equal(joined.status, 201, `${suffix}: ${joined.text}`);
  }
  assert.equal((await store.listMembers(code)).length, 10);

  const eleventhToken = token("G");
  await register(store, eleventhToken, { displayName: "I njëmbëdhjeti" });
  const refused = await callApi({
    method: "POST",
    path: `/api/rrethi/circles/${code}/join`,
    token: eleventhToken,
    body: {},
    store,
  });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, "circle_full");
  assert.equal((await store.listMembers(code)).length, 10);

  // A freed seat is reclaimable, and seat numbers never appear on the wire.
  await callApi({
    method: "DELETE",
    path: `/api/rrethi/circles/${code}/members/me`,
    token: token("8"),
    store,
  });
  const readmitted = await callApi({
    method: "POST",
    path: `/api/rrethi/circles/${code}/join`,
    token: eleventhToken,
    body: {},
    store,
  });
  assert.equal(readmitted.status, 201, readmitted.text);
  assert.equal((await store.listMembers(code)).length, 10);
  assert.ok(!readmitted.text.includes("seat"));
});

test("33. a repeat join is 200 and changes nothing", async () => {
  const { store, code } = await twoMemberCircle();
  const before = await store.listMembers(code);

  const again = await callApi({
    method: "POST",
    path: `/api/rrethi/circles/${code}/join`,
    token: TOKEN_B,
    body: {},
    store,
  });
  assert.equal(again.status, 200);
  assert.equal(again.body.memberCount, 2);

  const after = await store.listMembers(code);
  assert.deepEqual(
    after.map((member) => member.memberKey),
    before.map((member) => member.memberKey),
  );
});

test("34. an eleventh circle is 409 circle_limit_reached", async () => {
  const store = await freshStore();
  await register(store, TOKEN_A, { displayName: "Ana" });
  const keyB = await register(store, TOKEN_B, { displayName: "Ben" });

  // Ana creates ten circles and Ben joins all of them, so Ben reaches the cap
  // without spending his own daily creation bucket. Creating them as Ben would
  // make the 11th a 429 (that is checklist 38) and this test would prove
  // nothing about the cap.
  const codes = [];
  for (let index = 0; index < 10; index += 1) {
    const created = await callApi({
      method: "POST",
      path: "/api/rrethi/circles",
      token: TOKEN_A,
      body: { name: `Rrethi ${index}` },
      store,
    });
    assert.equal(created.status, 201, created.text);
    codes.push(created.body.code);
    const joined = await callApi({
      method: "POST",
      path: `/api/rrethi/circles/${created.body.code}/join`,
      token: TOKEN_B,
      body: {},
      store,
    });
    assert.equal(joined.status, 201, joined.text);
  }
  assert.equal((await store.listCirclesFor(keyB)).length, 10);

  // The handler's own pre-check refuses an eleventh circle of Ben's own.
  const created = await callApi({
    method: "POST",
    path: "/api/rrethi/circles",
    token: TOKEN_B,
    body: { name: "I njëmbëdhjeti" },
    store,
  });
  assert.equal(created.status, 409);
  assert.equal(created.body.error, "circle_limit_reached");

  // And claimSeat's own 'over_circle_limit' refuses an eleventh join, which is
  // the path that holds under concurrency rather than at handler level. A third
  // member mints the circle: Ana has spent her ten daily creations above.
  await register(store, TOKEN_C, { displayName: "Cen" });
  const eleventh = await callApi({
    method: "POST",
    path: "/api/rrethi/circles",
    token: TOKEN_C,
    body: { name: "Një tjetër" },
    store,
  });
  assert.equal(eleventh.status, 201, eleventh.text);
  const refusedJoin = await callApi({
    method: "POST",
    path: `/api/rrethi/circles/${eleventh.body.code}/join`,
    token: TOKEN_B,
    body: {},
    store,
  });
  assert.equal(refusedJoin.status, 409);
  assert.equal(refusedJoin.body.error, "circle_limit_reached");
  assert.equal((await store.listCirclesFor(keyB)).length, 10);
});

// ---------------------------------------------------------------------------
// Rate limits (checklist 36–42)
// ---------------------------------------------------------------------------

test("36. [M1 acceptance] 61 requests in a minute produce exactly one 429", async () => {
  const store = await freshStore();
  await register(store, TOKEN_A, { displayName: "Ana" }); // request 1
  const statuses = [];
  for (let index = 0; index < 60; index += 1) {
    const result = await callApi({ method: "DELETE", path: "/api/rrethi/me", token: TOKEN_A, store });
    statuses.push(result.status);
  }
  const limited = statuses.filter((status) => status === 429);
  assert.equal(limited.length, 1, `expected exactly one 429, saw ${limited.length}`);
  assert.equal(statuses[59], 429);

  const refused = await callApi({ method: "DELETE", path: "/api/rrethi/me", token: TOKEN_A, store });
  assert.equal(refused.status, 429);
  assert.equal(refused.body.error, "rate_limited");
  assert.equal(refused.headers.get("retry-after"), "60");
});

test("37. buckets are per member, not global", async () => {
  const store = await freshStore();
  await register(store, TOKEN_A, { displayName: "Ana" });
  await register(store, TOKEN_B, { displayName: "Ben" });
  for (let index = 0; index < 60; index += 1) {
    await callApi({ method: "DELETE", path: "/api/rrethi/me", token: TOKEN_A, store });
  }
  const exhausted = await callApi({ method: "DELETE", path: "/api/rrethi/me", token: TOKEN_A, store });
  assert.equal(exhausted.status, 429);

  const other = await callApi({ method: "DELETE", path: "/api/rrethi/me", token: TOKEN_B, store });
  assert.equal(other.status, 204);
});

test("38. the eleventh circle creation in a day is 429, not 409", async () => {
  const store = await freshStore();
  await register(store, TOKEN_A, { displayName: "Ana" });
  for (let index = 0; index < 10; index += 1) {
    const created = await callApi({
      method: "POST",
      path: "/api/rrethi/circles",
      token: TOKEN_A,
      body: { name: `Rrethi ${index}` },
      store,
    });
    assert.equal(created.status, 201);
    // Free the per-member circle cap so the daily bucket is the only limit left.
    await callApi({
      method: "DELETE",
      path: `/api/rrethi/circles/${created.body.code}/members/me`,
      token: TOKEN_A,
      store,
    });
  }
  const eleventh = await callApi({
    method: "POST",
    path: "/api/rrethi/circles",
    token: TOKEN_A,
    body: { name: "I njëmbëdhjeti" },
    store,
  });
  assert.equal(eleventh.status, 429);
  assert.equal(eleventh.body.error, "rate_limited");
  assert.equal(eleventh.headers.get("retry-after"), "3600");
});

test("39. the twenty-first join in a day is 429", async () => {
  const store = await freshStore();
  await register(store, TOKEN_A, { displayName: "Ana" });
  await register(store, TOKEN_B, { displayName: "Ben" });

  const codes = [];
  for (let index = 0; index < 10; index += 1) {
    const created = await callApi({
      method: "POST",
      path: "/api/rrethi/circles",
      token: TOKEN_A,
      body: { name: `Rrethi ${index}` },
      store,
    });
    codes.push(created.body.code);
  }

  // Twenty joins: ten real ones, then ten idempotent repeats — the bucket counts
  // attempts, not new memberships.
  let taken = 0;
  for (const pass of [0, 1]) {
    for (const code of codes) {
      const joined = await callApi({
        method: "POST",
        path: `/api/rrethi/circles/${code}/join`,
        token: TOKEN_B,
        body: {},
        store,
      });
      assert.equal(joined.status, pass === 0 ? 201 : 200, joined.text);
      taken += 1;
    }
  }
  assert.equal(taken, 20);

  const refused = await callApi({
    method: "POST",
    path: `/api/rrethi/circles/${codes[0]}/join`,
    token: TOKEN_B,
    body: {},
    store,
  });
  assert.equal(refused.status, 429);
  assert.equal(refused.headers.get("retry-after"), "3600");
});

test("40. a malformed bearer charges the anonymous bucket, not a member one", async () => {
  const store = await freshStore();
  await register(store, TOKEN_A, { displayName: "Ana" });

  const headers = { "x-forwarded-for": "203.0.113.7, 70.41.3.18" };
  let limited = 0;
  for (let index = 0; index < 61; index += 1) {
    const result = await callApi({
      method: "GET",
      path: "/api/rrethi/circles/8G2K4M9P1QRTV",
      token: "not-a-canonical-token",
      headers,
      store,
    });
    if (result.status === 429) limited += 1;
    else assert.equal(result.status, 401);
  }
  assert.equal(limited, 1);

  // A valid member in the same minute is unaffected.
  const member = await callApi({
    method: "DELETE",
    path: "/api/rrethi/me",
    token: TOKEN_A,
    headers,
    store,
  });
  assert.equal(member.status, 204);
});

test("41. no stored bucket key contains a member key, an IP, or any substring of either", async () => {
  const recorded = [];
  const inner = await freshStore();
  const store = {
    ...inner,
    takeToken: async (bucket, limit, windowMs) => {
      recorded.push(bucket);
      return inner.takeToken(bucket, limit, windowMs);
    },
  };
  const ip = "203.0.113.7";
  const memberId = await register(store, TOKEN_A, { displayName: "Ana" });
  await callApi({
    method: "POST",
    path: "/api/rrethi/circles",
    token: TOKEN_A,
    body: { name: "Familja" },
    headers: { "x-forwarded-for": ip },
    store,
  });
  await callApi({
    method: "GET",
    path: "/api/rrethi/circles/8G2K4M9P1QRTV",
    token: "bad",
    headers: { "x-forwarded-for": ip },
    store,
  });

  assert.ok(recorded.length >= 3);
  for (const bucket of recorded) {
    assert.match(bucket, /^rl1:(?:min|create|join|ip):[0-9a-f]{32}$/u);
    assert.ok(!bucket.includes(memberId));
    assert.ok(!bucket.includes(ip));
    assert.ok(!bucket.includes("203"));
    assert.ok(!bucket.includes(TOKEN_A));
    // Not even a prefix of the member key survives the HMAC.
    assert.ok(!bucket.includes(memberId.slice(0, 8)));
  }
});

test("42. the anonymous bucket key rotates with the hour", async () => {
  const { anonymousBucket } = await import("../api/_lib/limits.js");
  const pepper = Buffer.from(PEPPER, "hex");
  const hour = 3_600_000;
  const first = anonymousBucket("203.0.113.7", pepper, 10 * hour);
  const same = anonymousBucket("203.0.113.7", pepper, 10 * hour + 59 * 60_000);
  const next = anonymousBucket("203.0.113.7", pepper, 11 * hour);
  assert.equal(first, same);
  assert.notEqual(first, next);
  // A client we cannot distinguish shares one conservative bucket.
  assert.equal(
    anonymousBucket(undefined, pepper, 10 * hour),
    anonymousBucket("", pepper, 10 * hour),
  );
});

// ---------------------------------------------------------------------------
// Deletion and cascade (checklist 43–46)
// ---------------------------------------------------------------------------

test("43. [M3 acceptance] deleting is 204, and a repeat delete is 204", async () => {
  const store = await freshStore();
  await register(store, TOKEN_A, { displayName: "Ana" });
  const first = await callApi({ method: "DELETE", path: "/api/rrethi/me", token: TOKEN_A, store });
  assert.equal(first.status, 204);
  assert.equal(first.text, "");
  const second = await callApi({ method: "DELETE", path: "/api/rrethi/me", token: TOKEN_A, store });
  assert.equal(second.status, 204);
});

test("44. deletion clears the member from another member's board and takes their circles", async () => {
  const { store, code } = await twoMemberCircle();
  const today = getTiranaDateKey(new Date());
  await postResult(store, TOKEN_A, code, { date: today, attempts: 3, besa: false, hint: false });
  await postResult(store, TOKEN_B, code, { date: today, attempts: 4, besa: false, hint: false });

  const before = await callApi({ method: "GET", path: `/api/rrethi/circles/${code}/board`, token: TOKEN_B, store });
  assert.equal(before.body.rows.length, 2);

  // Ana owns the circle, so deleting her takes it with her — schema.sql's
  // recorded decision that an FK must never block a deletion request.
  await callApi({ method: "DELETE", path: "/api/rrethi/me", token: TOKEN_A, store });

  const after = await callApi({ method: "GET", path: `/api/rrethi/circles/${code}/board`, token: TOKEN_B, store });
  assert.equal(after.status, 404);
  assert.equal(await store.getCircle(code), null);
  assert.deepEqual(await store.listResults(code, today), []);
});

test("45. leaving a circle clears that circle's results only", async () => {
  const store = await freshStore();
  await register(store, TOKEN_A, { displayName: "Ana" });
  await register(store, TOKEN_B, { displayName: "Ben" });
  const today = getTiranaDateKey(new Date());

  const codes = [];
  for (const name of ["Familja", "Shokët"]) {
    const created = await callApi({
      method: "POST",
      path: "/api/rrethi/circles",
      token: TOKEN_A,
      body: { name },
      store,
    });
    codes.push(created.body.code);
    await callApi({ method: "POST", path: `/api/rrethi/circles/${created.body.code}/join`, token: TOKEN_B, body: {}, store });
    await postResult(store, TOKEN_B, created.body.code, { date: today, attempts: 3, besa: false, hint: false });
  }

  await callApi({
    method: "DELETE",
    path: `/api/rrethi/circles/${codes[0]}/members/me`,
    token: TOKEN_B,
    store,
  });
  assert.deepEqual(await store.listResults(codes[0], today), []);
  assert.equal((await store.listResults(codes[1], today)).length, 1);
});

test("46. leaving a circle the caller was never in is 204", async () => {
  const { store, code } = await twoMemberCircle();
  await register(store, TOKEN_C, { displayName: "Cen" });
  const stranger = await callApi({
    method: "DELETE",
    path: `/api/rrethi/circles/${code}/members/me`,
    token: TOKEN_C,
    store,
  });
  assert.equal(stranger.status, 204);
  assert.equal((await store.listMembers(code)).length, 2);

  const unknownCircle = await callApi({
    method: "DELETE",
    path: "/api/rrethi/circles/8G2K4M9P1QRTV/members/me",
    token: TOKEN_C,
    store,
  });
  assert.equal(unknownCircle.status, 204);
});

// ---------------------------------------------------------------------------
// Endpoint shapes not covered by a numbered line, but specified in §8
// ---------------------------------------------------------------------------

test("8.1 registering is idempotent and returns the profile echo, never a recovery code", async () => {
  const store = await freshStore();
  const first = await callApi({ method: "POST", path: "/api/rrethi/members", token: TOKEN_A, body: PROFILE, store });
  assert.equal(first.status, 201);
  assert.deepEqual(Object.keys(first.body).sort(), ["avatarId", "displayName", "letterSeal", "memberId"]);
  assert.ok(!first.text.includes("recovery"), "deviation D1: the server never mints a recovery code");

  const replay = await callApi({ method: "POST", path: "/api/rrethi/members", token: TOKEN_A, body: PROFILE, store });
  assert.equal(replay.status, 200);
  assert.deepEqual(replay.body, first.body);

  // The same endpoint is the profile edit; there is no PATCH among the nine.
  const edited = await callApi({
    method: "POST",
    path: "/api/rrethi/members",
    token: TOKEN_A,
    body: { displayName: "Anila", avatarId: "stick-runner", letterSeal: "ç" },
    store,
  });
  assert.equal(edited.status, 200);
  const stored = await store.getMember(first.body.memberId);
  assert.equal(stored.displayName, "Anila");
  assert.equal(stored.letterSeal, "ç");
});

test("8.3 the join card counts members but names none of them", async () => {
  const { store, code } = await twoMemberCircle();
  await register(store, TOKEN_C, { displayName: "Cen" });

  const outsider = await callApi({ method: "GET", path: `/api/rrethi/circles/${code}`, token: TOKEN_C, store });
  assert.equal(outsider.status, 200);
  assert.deepEqual(outsider.body, { code, name: "Familja", memberCount: 2, joined: false });
  for (const name of ["Ana", "Ben"]) {
    assert.ok(!outsider.text.includes(name), `the join card leaked ${name}`);
  }

  const insider = await callApi({ method: "GET", path: `/api/rrethi/circles/${code}`, token: TOKEN_B, store });
  assert.equal(insider.body.joined, true);

  const unknown = await callApi({ method: "GET", path: "/api/rrethi/circles/8G2K4M9P1QRTV", token: TOKEN_C, store });
  assert.equal(unknown.status, 404);
});

test("8.4 an invite code survives the shared cosmetics of the URL form", async () => {
  const { store, code } = await twoMemberCircle();
  await register(store, TOKEN_C, { displayName: "Cen" });

  const shared = `RR-${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`;
  const joined = await callApi({
    method: "POST",
    path: `/api/rrethi/circles/${shared}/join`,
    token: TOKEN_C,
    body: {},
    store,
  });
  assert.equal(joined.status, 201, joined.text);
  assert.equal(joined.body.code, code, "the canonical code comes back, not the shared form");

  for (const malformed of ["short", "8G2K4M9P1QRTVX", "8G2K4M9P1QRT!"]) {
    const result = await callApi({
      method: "POST",
      path: `/api/rrethi/circles/${malformed}/join`,
      token: TOKEN_C,
      body: {},
      store,
    });
    assert.equal(result.status, 400, malformed);
    assert.equal(result.body.field, "code");
  }
});

test("8.4 a display name sent at join applies globally, on every board", async () => {
  const { store, code } = await twoMemberCircle();
  const renamed = await callApi({
    method: "POST",
    path: `/api/rrethi/circles/${code}/join`,
    token: TOKEN_B,
    body: { displayName: "Benjamin" },
    store,
  });
  assert.equal(renamed.status, 200);
  const board = await callApi({ method: "GET", path: `/api/rrethi/circles/${code}/board`, token: TOKEN_A, store });
  assert.ok(board.body.rows.some((row) => row.displayName === "Benjamin"));
});

test("8.6 a non-member posting a result is 403 not_a_member, and a repeat is 409", async () => {
  const { store, code } = await twoMemberCircle();
  await register(store, TOKEN_C, { displayName: "Cen" });
  const today = getTiranaDateKey(new Date());

  const outsider = await postResult(store, TOKEN_C, code, {
    date: today,
    attempts: 3,
    besa: false,
    hint: false,
  });
  assert.equal(outsider.status, 403);
  assert.equal(outsider.body.error, "not_a_member");

  const first = await postResult(store, TOKEN_A, code, { date: today, attempts: 3, besa: false, hint: false });
  assert.equal(first.status, 201);
  assert.deepEqual(first.body, { playDate: today });

  // First write wins and the row is immutable; 409 is the outbox's "done".
  const repeat = await postResult(store, TOKEN_A, code, { date: today, attempts: 1, besa: true, hint: false });
  assert.equal(repeat.status, 409);
  assert.equal(repeat.body.error, "result_exists");
  assert.equal((await store.listResults(code, today))[0].attempts, 3);
});

test("8.6 seconds is dropped at write time while show_time is FALSE", async () => {
  const { store, code } = await twoMemberCircle();
  const today = getTiranaDateKey(new Date());
  const posted = await postResult(store, TOKEN_A, code, {
    date: today,
    attempts: 3,
    besa: false,
    hint: false,
    seconds: 91,
  });
  assert.equal(posted.status, 201);
  // Not merely stripped on read: never persisted. §2.10 promises elapsed time
  // leaves the device only if the circle enabled it.
  assert.equal((await store.listResults(code, today))[0].seconds, null);
});

test("8.7/8.8 a non-member is 403 and an unknown circle is 404 on both read endpoints", async () => {
  const { store, code } = await twoMemberCircle();
  await register(store, TOKEN_C, { displayName: "Cen" });
  for (const path of [`/api/rrethi/circles/${code}/board`, `/api/rrethi/circles/${code}/week`]) {
    const forbidden = await callApi({ method: "GET", path, token: TOKEN_C, store });
    assert.equal(forbidden.status, 403, path);
    assert.equal(forbidden.body.error, "not_a_member");
  }
  for (const path of ["/api/rrethi/circles/8G2K4M9P1QRTV/board", "/api/rrethi/circles/8G2K4M9P1QRTV/week"]) {
    const missing = await callApi({ method: "GET", path, token: TOKEN_C, store });
    assert.equal(missing.status, 404, path);
  }
});

test("an unknown path under /api/rrethi is 404, not a crash", async () => {
  const store = await freshStore();
  for (const path of [
    "/api/rrethi",
    "/api/rrethi/",
    "/api/rrethi/unknown",
    "/api/rrethi/circles/8G2K4M9P1QRTV/board/extra",
    "/api/rrethi/circles/8G2K4M9P1QRTV/members/someone-else",
  ]) {
    const result = await callApi({ method: "GET", path, token: TOKEN_A, store });
    assert.equal(result.status, 404, path);
    assert.equal(result.body.error, "not_found");
  }
});

// ---------------------------------------------------------------------------
// Over a real socket
//
// Everything above drives the router with a hand-built request object. That is
// fast and lets a test pin a clock, but it is not proof: a real
// `http.IncomingMessage` streams differently, lower-cases headers itself,
// and carries a Content-Length the harness never had to parse. This block runs
// the same handler behind a real `node:http` server so the transport layer is
// exercised as it will be in production rather than as the harness imagines it.
// ---------------------------------------------------------------------------

test("the router works over a real HTTP socket, not just the test harness", async () => {
  const store = await freshStore();
  const server = createServer((request, response) => {
    handleRrethiRequest(request, response, ENV, { store }).catch(() => {
      response.statusCode = 500;
      response.end();
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const registered = await fetch(`${base}/api/rrethi/members`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN_A}`, "content-type": "application/json" },
      body: JSON.stringify(PROFILE),
    });
    assert.equal(registered.status, 201);
    assert.equal(registered.headers.get("cache-control"), "private, no-store, max-age=0");
    assert.equal(registered.headers.get("content-type"), "application/json; charset=utf-8");
    assert.equal(registered.headers.get("x-content-type-options"), "nosniff");
    assert.equal(registered.headers.get("access-control-allow-origin"), null, "CORS stays off");
    assert.equal(registered.headers.get("set-cookie"), null, "no cookie is ever set");
    const profile = await registered.json();
    assert.match(profile.memberId, /^[0-9a-f]{64}$/u);

    const created = await fetch(`${base}/api/rrethi/circles`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN_A}`, "content-type": "application/json" },
      body: JSON.stringify({ name: "Familja" }),
    });
    assert.equal(created.status, 201);
    const { code } = await created.json();
    assert.match(code, /^[0-9A-HJKMNP-TV-Z]{13}$/u);

    // A real browser preflight gets no answer, which is the second CSRF defence.
    const preflight = await fetch(`${base}/api/rrethi/circles`, { method: "OPTIONS" });
    assert.equal(preflight.status, 405);
    assert.equal(preflight.headers.get("allow"), "POST");

    // A same-origin browser POST over plain http, with the Origin header a
    // browser actually sends and node's fetch does not. This is the request
    // shape that was 403ing before the scheme fix.
    const sameOrigin = await fetch(`${base}/api/rrethi/circles`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN_A}`,
        "content-type": "application/json",
        origin: base,
      },
      body: JSON.stringify({ name: "Nga shfletuesi" }),
    });
    assert.equal(sameOrigin.status, 201, await sameOrigin.text());

    // A genuinely cross-origin POST over the wire.
    const crossOrigin = await fetch(`${base}/api/rrethi/circles`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN_A}`,
        "content-type": "application/json",
        origin: "https://evil.example",
      },
      body: JSON.stringify({ name: "E keqe" }),
    });
    assert.equal(crossOrigin.status, 403);
    assert.equal((await crossOrigin.json()).error, "forbidden_origin");

    // A real oversized body, streamed by the runtime rather than by a fixture.
    const oversized = await fetch(`${base}/api/rrethi/members`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN_A}`, "content-type": "application/json" },
      body: JSON.stringify({ ...PROFILE, pad: "x".repeat(50_000) }),
    });
    assert.equal(oversized.status, 413);

    const board = await fetch(`${base}/api/rrethi/circles/${code}/board`, {
      headers: { authorization: `Bearer ${TOKEN_A}` },
    });
    assert.equal(board.status, 200);
    const boardText = await board.text();
    assert.ok(!boardText.includes("attempts"), boardText);
    assert.equal(Number(board.headers.get("content-length")), Buffer.byteLength(boardText));

    const gone = await fetch(`${base}/api/rrethi/me`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${TOKEN_A}` },
    });
    assert.equal(gone.status, 204);
    assert.equal(await gone.text(), "");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("the gate is off by default, so an unconfigured deployment serves nothing", async () => {
  // RRETHI_API_ENABLED unset is the shipping default: the nine routes stay dark
  // until the M3 deploy that ships the rewritten privacy page beside them.
  const store = await freshStore();
  const server = createServer((request, response) => {
    handleRrethiRequest(request, response, { RRETHI_SERVER_PEPPER: PEPPER }, { store });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(`${base}/api/rrethi/members`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN_A}`, "content-type": "application/json" },
      body: JSON.stringify(PROFILE),
    });
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error, "not_found");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("a malformed JSON body is 400 malformed_json, and unknown keys are ignored", async () => {
  const store = await freshStore();
  for (const body of ["{", "[]", "null", '"Ana"', "42"]) {
    const result = await callApi({ method: "POST", path: "/api/rrethi/members", token: TOKEN_A, body, store });
    assert.equal(result.status, 400, body);
    assert.equal(result.body.error, "malformed_json");
  }
  // An older deployment must not break on a newer client's extra field.
  const tolerated = await callApi({
    method: "POST",
    path: "/api/rrethi/members",
    token: TOKEN_A,
    body: { ...PROFILE, futureField: "whatever", streak: 12 },
    store,
  });
  assert.equal(tolerated.status, 201);
  assert.ok(!tolerated.text.includes("futureField"));
});
