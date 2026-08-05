import { createHash, timingSafeEqual } from "node:crypto";

const JSON_HEADERS = Object.freeze({
  "Cache-Control": "private, no-store, max-age=0",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
});

const PEPPER_PATTERN = /^[0-9a-f]{64}$/iu;
const DEEP_TOKEN_PATTERN = /^[a-z0-9_-]{32,256}$/iu;
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
    // credentials, or other operational detail. Logs follow the same rule: a
    // driver message or stack can embed the connection URL, so retain only a
    // bounded error class and SQLSTATE-style code.
    const errorName = /^[a-z][a-z0-9_.-]{0,63}$/iu.test(String(error?.name ?? ""))
      ? String(error.name)
      : "Error";
    const errorCode = /^[a-z0-9_.-]{1,32}$/iu.test(String(error?.code ?? ""))
      ? String(error.code)
      : "unknown";
    console.error("health: deep database check failed", { name: errorName, code: errorCode });
  }
  return database;
}

// One authorized deep database probe per warm instance per minute, whatever the
// monitor request rate: without this, frequent legitimate checks could keep
// Neon's autosuspend from firing and drain the free compute allowance.
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

// Hash both inputs first so timingSafeEqual always compares the same number of
// bytes. This avoids an early length branch while still requiring an exact,
// case-sensitive header match.
function tokensMatch(presented, expected) {
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

function sendJson(response, method, statusCode, body) {
  const payload = `${JSON.stringify(body)}\n`;
  response.setHeader("Content-Length", Buffer.byteLength(payload));
  response.statusCode = statusCode;
  response.end(method === "HEAD" ? undefined : payload);
}

export async function handleHealthRequest(request, response, env = process.env, options = {}) {
  const method = String(request.method ?? "GET").toUpperCase();
  for (const [name, value] of Object.entries(JSON_HEADERS)) {
    response.setHeader(name, value);
  }

  if (method !== "GET" && method !== "HEAD") {
    response.setHeader("Allow", "GET, HEAD");
    sendJson(response, method, 405, { status: "error", error: "method_not_allowed" });
    return;
  }

  let deep = false;
  try {
    deep = new URL(request.url ?? "/api/health", "http://localhost").searchParams.get("deep") === "1";
  } catch {
    // A malformed URL receives the shallow response; it never earns a DB query.
  }

  // A Neon deep check spends database compute. It must never become public just
  // because HEALTH_DEEP_TOKEN was forgotten or malformed. Memory-mode deep
  // checks remain open because they do not touch a database.
  const store = String(env?.RRETHI_STORE ?? "memory").trim().toLowerCase() || "memory";
  if (deep && store === "neon") {
    const deepToken = String(env?.HEALTH_DEEP_TOKEN ?? "");
    if (!DEEP_TOKEN_PATTERN.test(deepToken)) {
      sendJson(response, method, 503, {
        status: "degraded",
        service: "fjale",
        checks: {
          app: "ok",
          database: "not_checked",
          identity: "not_checked",
          deep: "misconfigured",
        },
      });
      return;
    }

    const presented = String(request.headers?.["x-health-token"] ?? "");
    if (!tokensMatch(presented, deepToken)) {
      sendJson(response, method, 401, {
        status: "unauthorized",
        service: "fjale",
        checks: {
          app: "ok",
          database: "not_checked",
          identity: "not_checked",
          deep: "unauthorized",
        },
      });
      return;
    }
  }

  const healthOptions = options.checkDatabase
    ? { deep, checkDatabase: options.checkDatabase }
    : { deep };
  const { statusCode, body } = await buildHealthResponse(env, healthOptions);
  sendJson(response, method, statusCode, body);
}

export default handleHealthRequest;
