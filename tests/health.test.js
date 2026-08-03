import test from "node:test";
import assert from "node:assert/strict";

import { buildHealthResponse, handleHealthRequest } from "../api/health.js";

const VALID_PEPPER = "a".repeat(64);
const VALID_DEEP_TOKEN = "b".repeat(64);
const CONFIGURED_DATABASE = "postgresql://configured.invalid/fjale";

function responseProbe() {
  const headers = new Map();
  return {
    headers,
    statusCode: 0,
    body: undefined,
    setHeader(name, value) {
      headers.set(name.toLowerCase(), String(value));
    },
    end(body) {
      this.body = body;
    },
  };
}

test("shallow health stays healthy without waking the database", async () => {
  let calls = 0;
  const result = await buildHealthResponse(
    {
      RRETHI_STORE: "neon",
      RRETHI_SERVER_PEPPER: VALID_PEPPER,
      NEON_DATABASE_URL: CONFIGURED_DATABASE,
    },
    {
      checkDatabase: async () => {
        calls += 1;
        return { schemaReady: true };
      },
    },
  );

  assert.equal(result.statusCode, 200);
  assert.equal(calls, 0);
  assert.deepEqual(result.body.checks, {
    app: "ok",
    database: "configured",
    identity: "ok",
  });
});

test("deep health verifies Neon schema readiness", async () => {
  const healthy = await buildHealthResponse(
    {
      RRETHI_STORE: "neon",
      RRETHI_SERVER_PEPPER: VALID_PEPPER,
      NEON_DATABASE_URL: CONFIGURED_DATABASE,
    },
    { deep: true, checkDatabase: async () => ({ schemaReady: true }) },
  );
  const missing = await buildHealthResponse(
    {
      RRETHI_STORE: "neon",
      RRETHI_SERVER_PEPPER: VALID_PEPPER,
      NEON_DATABASE_URL: CONFIGURED_DATABASE,
    },
    { deep: true, checkDatabase: async () => ({ schemaReady: false }) },
  );

  assert.equal(healthy.statusCode, 200);
  assert.equal(healthy.body.checks.database, "ok");
  assert.equal(missing.statusCode, 503);
  assert.equal(missing.body.checks.database, "schema_missing");
});

test("health failures never expose driver errors or secrets", async () => {
  const secret = "postgresql://user:password@example.invalid/database";
  const originalConsoleError = console.error;
  const logged = [];
  console.error = (...parts) => logged.push(parts);
  try {
    const result = await buildHealthResponse(
      {
        RRETHI_STORE: "neon",
        RRETHI_SERVER_PEPPER: VALID_PEPPER,
        NEON_DATABASE_URL: secret,
      },
      {
        deep: true,
        checkDatabase: async () => {
          const error = new Error(secret);
          error.code = "08006";
          throw error;
        },
      },
    );
    const serialized = JSON.stringify(result.body);
    const serializedLog = JSON.stringify(logged);

    assert.equal(result.statusCode, 503);
    assert.equal(result.body.checks.database, "unavailable");
    assert.ok(!serialized.includes("password"));
    assert.ok(!serialized.includes("example.invalid"));
    assert.ok(!serializedLog.includes("password"));
    assert.ok(!serializedLog.includes("example.invalid"));
    assert.match(serializedLog, /08006/u);
  } finally {
    console.error = originalConsoleError;
  }
});

test("health reports disabled and invalid configurations explicitly", async () => {
  const memory = await buildHealthResponse({ RRETHI_STORE: "memory" });
  const deepMemory = await buildHealthResponse({ RRETHI_STORE: "memory" }, { deep: true });
  const badStore = await buildHealthResponse({ RRETHI_STORE: "sqlite" });
  const missingDatabase = await buildHealthResponse({
    RRETHI_STORE: "neon",
    RRETHI_SERVER_PEPPER: VALID_PEPPER,
  });
  const badPepper = await buildHealthResponse({
    RRETHI_STORE: "neon",
    RRETHI_SERVER_PEPPER: "short",
    NEON_DATABASE_URL: CONFIGURED_DATABASE,
  });

  assert.equal(memory.statusCode, 200);
  assert.equal(memory.body.checks.database, "disabled");
  // Deep on the memory store is 200 "ok": the disabled database is the intended
  // pre-Rrethi production state, and a monitor must not page for it.
  assert.equal(deepMemory.statusCode, 200);
  assert.equal(deepMemory.body.status, "ok");
  assert.equal(deepMemory.body.checks.database, "disabled");
  assert.equal(badStore.statusCode, 503);
  assert.equal(badStore.body.checks.database, "misconfigured");
  assert.equal(missingDatabase.statusCode, 503);
  assert.equal(missingDatabase.body.checks.database, "misconfigured");
  assert.equal(badPepper.statusCode, 503);
  assert.equal(badPepper.body.checks.identity, "misconfigured");
});

test("Neon deep health fails closed when its token is missing or weak", async () => {
  const baseEnv = {
    RRETHI_STORE: "neon",
    RRETHI_SERVER_PEPPER: VALID_PEPPER,
    NEON_DATABASE_URL: CONFIGURED_DATABASE,
  };

  for (const healthToken of [undefined, "too-short", ` ${VALID_DEEP_TOKEN} `]) {
    let calls = 0;
    const response = responseProbe();
    await handleHealthRequest(
      { method: "GET", url: "/api/health?deep=1", headers: {} },
      response,
      { ...baseEnv, HEALTH_DEEP_TOKEN: healthToken },
      {
        checkDatabase: async () => {
          calls += 1;
          return { schemaReady: true };
        },
      },
    );

    assert.equal(response.statusCode, 503);
    assert.equal(JSON.parse(response.body).checks.deep, "misconfigured");
    assert.equal(calls, 0);
  }
});

test("Neon deep health requires one exact token and probes only after authorization", async () => {
  const env = {
    RRETHI_STORE: "neon",
    RRETHI_SERVER_PEPPER: VALID_PEPPER,
    NEON_DATABASE_URL: CONFIGURED_DATABASE,
    HEALTH_DEEP_TOKEN: VALID_DEEP_TOKEN,
  };

  const rejectedHeaders = [
    {},
    { "x-health-token": "wrong" },
    { "x-health-token": VALID_DEEP_TOKEN.toUpperCase() },
    { "x-health-token": ` ${VALID_DEEP_TOKEN} ` },
    { "x-health-token": [VALID_DEEP_TOKEN, VALID_DEEP_TOKEN] },
  ];
  let calls = 0;
  const checkDatabase = async () => {
    calls += 1;
    return { schemaReady: true };
  };

  for (const headers of rejectedHeaders) {
    const response = responseProbe();
    await handleHealthRequest(
      { method: "GET", url: "/api/health?deep=1", headers },
      response,
      env,
      { checkDatabase },
    );
    assert.equal(response.statusCode, 401);
    assert.equal(JSON.parse(response.body).checks.deep, "unauthorized");
  }
  assert.equal(calls, 0);

  const authorized = responseProbe();
  await handleHealthRequest(
    {
      method: "GET",
      url: "/api/health?deep=1",
      headers: { "x-health-token": VALID_DEEP_TOKEN },
    },
    authorized,
    env,
    { checkDatabase },
  );
  assert.equal(authorized.statusCode, 200);
  assert.equal(JSON.parse(authorized.body).checks.database, "ok");
  assert.equal(calls, 1);
});

test("shallow and memory health never require the deep token", async () => {
  const shallow = responseProbe();
  await handleHealthRequest(
    { method: "GET", url: "/api/health", headers: {} },
    shallow,
    {
      RRETHI_STORE: "neon",
      RRETHI_SERVER_PEPPER: VALID_PEPPER,
      NEON_DATABASE_URL: CONFIGURED_DATABASE,
    },
  );
  assert.equal(shallow.statusCode, 200);
  assert.equal(JSON.parse(shallow.body).checks.database, "configured");

  const memory = responseProbe();
  await handleHealthRequest(
    { method: "GET", url: "/api/health?deep=1", headers: {} },
    memory,
    { RRETHI_STORE: "memory" },
  );
  assert.equal(memory.statusCode, 200);
  assert.equal(JSON.parse(memory.body).checks.database, "disabled");
});

test("HTTP health handler supports HEAD and rejects writes without caching", async () => {
  const env = { RRETHI_STORE: "memory" };
  const head = responseProbe();
  await handleHealthRequest({ method: "HEAD", url: "/api/health" }, head, env);
  assert.equal(head.statusCode, 200);
  assert.equal(head.body, undefined);
  assert.equal(head.headers.get("cache-control"), "private, no-store, max-age=0");

  const post = responseProbe();
  await handleHealthRequest({ method: "POST", url: "/api/health" }, post, env);
  assert.equal(post.statusCode, 405);
  assert.equal(post.headers.get("allow"), "GET, HEAD");
});
