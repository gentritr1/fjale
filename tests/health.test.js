import test from "node:test";
import assert from "node:assert/strict";

import { buildHealthResponse, handleHealthRequest } from "../api/health.js";

const VALID_PEPPER = "a".repeat(64);
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
  const result = await buildHealthResponse(
    {
      RRETHI_STORE: "neon",
      RRETHI_SERVER_PEPPER: VALID_PEPPER,
      NEON_DATABASE_URL: secret,
    },
    {
      deep: true,
      checkDatabase: async () => {
        throw new Error(secret);
      },
    },
  );
  const serialized = JSON.stringify(result.body);

  assert.equal(result.statusCode, 503);
  assert.equal(result.body.checks.database, "unavailable");
  assert.ok(!serialized.includes("password"));
  assert.ok(!serialized.includes("example.invalid"));
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
  assert.equal(deepMemory.statusCode, 503);
  assert.equal(deepMemory.body.status, "degraded");
  assert.equal(badStore.statusCode, 503);
  assert.equal(badStore.body.checks.database, "misconfigured");
  assert.equal(missingDatabase.statusCode, 503);
  assert.equal(missingDatabase.body.checks.database, "misconfigured");
  assert.equal(badPepper.statusCode, 503);
  assert.equal(badPepper.body.checks.identity, "misconfigured");
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
