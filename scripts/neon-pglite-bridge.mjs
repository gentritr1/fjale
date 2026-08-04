// Neon-over-pglite bridge — lets CI execute the Neon adapter's SQL with no
// database service. Usage (or `npm run test:neon-bridge`):
//
//   node --import ./scripts/neon-pglite-bridge.mjs --test tests/rrethi-store.test.js
//
// Loaded with `--import`, this module runs before the test file: it boots
// @electric-sql/pglite (real Postgres compiled to WASM), serves
// @neondatabase/serverless's HTTP fetch protocol on 127.0.0.1, points the
// driver's `neonConfig.fetchEndpoint` at it, and defaults
// RRETHI_TEST_NEON_URL so the conformance suite un-skips its Neon block.
// The adapter under test (api/_lib/store-neon.js) runs byte-for-byte
// unmodified — its SQL, its RETURNING conflict mapping, its SQLSTATE
// translation all execute against genuine Postgres semantics.
//
// Honest caveat: this is real Postgres, but it is NOT Neon-the-service.
// Network behavior, connection pooling, autosuspend, and any Neon-side
// quirks stay unexercised; only a run against a real (scratch) Neon project
// covers those. See RRETHI_TEST_NEON_URL in .env.example for that path.
//
// Wire protocol (verified against @neondatabase/serverless 1.1.0): the
// driver POSTs `{query, params}` and, in its default Neon-Raw-Text-Output +
// Neon-Array-Mode mode, expects `{rows, fields, command, rowCount}` with
// every value as Postgres raw text. Errors must be HTTP 400 with
// `{message, code, ...}` — `code` carries the SQLSTATE that the adapter's
// `mapError` switches on (23503 → foreignKeyError, etc.).
//
// Both dependencies are dev-path only. The default `npm test` never loads
// this file, so `rm -rf node_modules && npm test` stays green with the Neon
// block skipping gracefully.

import { createServer } from "node:http";

let PGlite;
let neonConfig;
try {
  ({ PGlite } = await import("@electric-sql/pglite"));
  ({ neonConfig } = await import("@neondatabase/serverless"));
} catch (cause) {
  console.error(
    "neon-pglite-bridge: @electric-sql/pglite and @neondatabase/serverless " +
      "must be installed (npm install) — this bridge is for the dev/CI path only.",
    cause?.message ?? cause,
  );
  process.exit(1);
}

const db = new PGlite(); // in-memory Postgres, discarded when the process exits

// Postgres raw-text encoding for the driver's Neon-Raw-Text-Output mode. The
// adapter formats DATE/TIMESTAMPTZ as text in SQL itself (to_char), so the
// only conversions needed here are booleans and NULLs.
function toRawText(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? "t" : "f";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

const server = createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => (body += chunk));
  request.on("end", async () => {
    try {
      const { query, params } = JSON.parse(body);
      const result = await db.query(query, params ?? [], { rowMode: "array" });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          command: "SELECT",
          rowCount: result.affectedRows ?? result.rows?.length ?? 0,
          // dataTypeID 25 (text) everywhere: raw-text mode hands the adapter
          // strings, and the adapter already coerces numbers and booleans.
          fields: (result.fields ?? []).map((f) => ({ name: f.name, dataTypeID: 25 })),
          rows: (result.rows ?? []).map((row) => row.map(toRawText)),
          rowAsArray: true,
        }),
      );
    } catch (error) {
      // Neon's 400 shape; `code` is the SQLSTATE the adapter's mapError needs.
      response.writeHead(400, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          message: String(error?.message ?? error),
          code: error?.code ?? error?.sqlState ?? undefined,
          severity: "ERROR",
        }),
      );
    }
  });
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
// unref: the bridge must never keep the test process alive after the run.
server.unref();
const { port } = server.address();
neonConfig.fetchEndpoint = `http://127.0.0.1:${port}/sql`;

// Un-skip the suite's Neon block. The URL's content is never dialed — the
// fetchEndpoint override above intercepts every query — but the adapter's
// resolveConnectionString still requires a non-empty value. `.invalid` is the
// RFC 2606 reserved TLD, so nothing can resolve it if the override were lost.
process.env.RRETHI_TEST_NEON_URL ??= "postgres://bridge:bridge@bridge.invalid/bridge";

console.error(`neon-pglite-bridge: real-Postgres bridge listening on 127.0.0.1:${port}`);
