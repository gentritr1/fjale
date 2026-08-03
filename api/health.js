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
    const healthy = !deep;
    return {
      statusCode: healthy ? 200 : 503,
      body: {
        status: healthy ? "ok" : "degraded",
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

  let database = "unavailable";
  try {
    const result = await checkDatabase(env);
    database = result?.schemaReady ? "ok" : "schema_missing";
  } catch {
    // Public health responses never include driver errors, hostnames, schemas,
    // credentials, or other operational detail.
  }

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

  const { statusCode, body } = await buildHealthResponse(env, { deep });
  const payload = `${JSON.stringify(body)}\n`;
  response.setHeader("Content-Length", Buffer.byteLength(payload));
  response.statusCode = statusCode;
  response.end(method === "HEAD" ? undefined : payload);
}

export default handleHealthRequest;
