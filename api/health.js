import { timingSafeEqual } from "node:crypto";

const JSON_HEADERS = Object.freeze({
  "Cache-Control": "private, no-store, max-age=0",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
});

const PEPPER_PATTERN = /^[0-9a-f]{64}$/iu;
const DATABASE_URL_KEYS = Object.freeze([
  "NEON_DATABASE_URL",
  "DATABASE_URL",
  "POSTGRES_URL",
]);

function hasDatabaseUrl(env) {
  return DATABASE_URL_KEYS.some(
    (key) => typeof env?.[key] === "string" && env[key].trim() !== "",
  );
}

async function checkDatabaseWithNeon(env) {
  // Keep the driver and Neon adapter off the shallow/liveness path. A monitor
  // can call /api/health frequently without waking the free database compute.
  const { checkNeonHealth } = await import("./_lib/store-neon.js");
  return checkNeonHealth(env);
}

// The single probe body shared by the memoized production path and the
// injected-double test path — one copy, so they can never silently diverge.
async function probeDatabaseStatus(env, checkDatabase) {
  let database = "unavailable";
  try {
    const result = await checkDatabase(env);
    database = result?.schemaReady ? "ok" : "schema_missing";
  } catch (error) {
    // Public health responses never include driver errors, hostnames, schemas,
    // credentials, or other operational detail. Function logs are private, so
    // the cause is recorded there — otherwise a DNS failure and a permissions
    // error are indistinguishable "unavailable"s.
    console.error("health: deep database check failed", error);
  }
  return database;
}

// One deep database probe per warm instance per minute, whatever the request
// rate: without this, anyone polling ?deep=1 at <5-minute intervals would keep
// Neon's autosuspend from ever firing and drain the free compute allowance.
// Only the real probe is memoized — injected `checkDatabase` test doubles skip
// it (see buildHealthResponse), so tests stay isolated.
const DEEP_MEMO_TTL_MS = 60_000;
let deepMemo = { at: 0, database: null };

async function memoizedDatabaseStatus(env, checkDatabase) {
  const now = Date.now();
  if (deepMemo.database !== null && now - deepMemo.at < DEEP_MEMO_TTL_MS) {
    return deepMemo.database;
  }
  const database = await probeDatabaseStatus(env, checkDatabase);
  deepMemo = { at: now, database };
  return database;
}

/**
 * Builds a deterministic, non-sensitive health response.
 *
 * @param {Record<string, string|undefined>} env
 * @param {{deep?: boolean, checkDatabase?: Function}} [options]
 * @returns {Promise<{statusCode: number, body: Record<string, unknown>}>}
 */
export async function buildHealthResponse(env = process.env, options = {}) {
  const deep = Boolean(options.deep);
  const checkDatabase = options.checkDatabase ?? checkDatabaseWithNeon;
  const store = String(env?.RRETHI_STORE ?? "memory").trim().toLowerCase() || "memory";

  if (store === "memory") {
    // Deep on a deliberately disabled store is 200, not 503: the memory store
    // is the intended production configuration until the Rrethi rollout, and a
    // monitor pointed at ?deep=1 must not page for a state that is by design.
    return {
      statusCode: 200,
      body: {
        status: "ok",
        service: "fjale",
        checks: { app: "ok", database: "disabled", identity: "disabled" },
      },
    };
  }

  if (store !== "neon") {
    return {
      statusCode: 503,
      body: {
        status: "degraded",
        service: "fjale",
        checks: { app: "ok", database: "misconfigured", identity: "misconfigured" },
      },
    };
  }

  const identity = PEPPER_PATTERN.test(String(env?.RRETHI_SERVER_PEPPER ?? ""))
    ? "ok"
    : "misconfigured";
  const configuredDatabase = hasDatabaseUrl(env) ? "configured" : "misconfigured";
  if (!deep) {
    const healthy = configuredDatabase === "configured" && identity === "ok";
    return {
      statusCode: healthy ? 200 : 503,
      body: {
        status: healthy ? "ok" : "degraded",
        service: "fjale",
        checks: { app: "ok", database: configuredDatabase, identity },
      },
    };
  }

  if (configuredDatabase === "misconfigured") {
    return {
      statusCode: 503,
      body: {
        status: "degraded",
        service: "fjale",
        checks: { app: "ok", database: "misconfigured", identity },
      },
    };
  }

  // Injected checkDatabase doubles (tests) bypass the memo; the real probe is
  // memoized for DEEP_MEMO_TTL_MS per warm instance. Both call the same
  // probeDatabaseStatus body.
  const database = options.checkDatabase
    ? await probeDatabaseStatus(env, checkDatabase)
    : await memoizedDatabaseStatus(env, checkDatabase);

  const healthy = database === "ok" && identity === "ok";
  return {
    statusCode: healthy ? 200 : 503,
    body: {
      status: healthy ? "ok" : "degraded",
      service: "fjale",
      checks: { app: "ok", database, identity },
    },
  };
}

/** Constant-time token comparison; a plain `!==` leaks match length by timing. */
function tokensMatch(presented, expected) {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

export async function handleHealthRequest(request, response, env = process.env) {
  const method = String(request.method ?? "GET").toUpperCase();
  for (const [name, value] of Object.entries(JSON_HEADERS)) {
    response.setHeader(name, value);
  }

  if (method !== "GET" && method !== "HEAD") {
    const payload = `${JSON.stringify({ status: "error", error: "method_not_allowed" })}\n`;
    response.setHeader("Allow", "GET, HEAD");
    response.setHeader("Content-Length", Buffer.byteLength(payload));
    response.statusCode = 405;
    response.end(payload);
    return;
  }

  let deep = false;
  try {
    deep = new URL(request.url ?? "/api/health", "http://localhost").searchParams.get("deep") === "1";
  } catch {
    // A malformed URL receives the shallow response; it never earns a DB query.
  }

  // When HEALTH_DEEP_TOKEN is set, deep checks require the matching header and
  // anonymous callers silently get the shallow response — the deep path costs
  // database compute, so it is not left open to the public internet. Unset
  // (local dev, or pre-Rrethi where the store is memory) leaves deep open.
  const deepToken = String(env?.HEALTH_DEEP_TOKEN ?? "").trim();
  if (deep && deepToken !== "") {
    const presented = String(request.headers?.["x-health-token"] ?? "");
    if (!tokensMatch(presented, deepToken)) {
      deep = false;
    }
  }

  const { statusCode, body } = await buildHealthResponse(env, { deep });
  const payload = `${JSON.stringify(body)}\n`;
  response.setHeader("Content-Length", Buffer.byteLength(payload));
  response.statusCode = statusCode;
  response.end(method === "HEAD" ? undefined : payload);
}

export default handleHealthRequest;
