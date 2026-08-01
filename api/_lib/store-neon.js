// Neon (serverless Postgres) RrethiStore — PLAN-RRETHI-2026-08.md §2.9.
//
// CI constraint, load-bearing: `@neondatabase/serverless` is imported with a
// dynamic `import()` inside `connect()` and nowhere else. This module is itself
// only reached through the dynamic import in `createStore()`, so the default
// test path never touches `node_modules` and `rm -rf node_modules && npm test`
// stays green. Do not add a top-level import of the driver.
//
// Boundary rules this file exists to keep (plan §2.9):
//
//   * No driver type escapes. Every `DATE` leaves as `to_char(..., 'YYYY-MM-DD')`
//     and every `TIMESTAMPTZ` as an ISO-8601 UTC string, formatted in SQL rather
//     than trusted to the driver's type parsers — that is what stops a
//     `Date` at local midnight from crossing the boundary.
//   * No driver *error* escapes either: `NeonDbError` is mapped to a plain
//     `Error` from `storeError()`, carrying the original as `cause`.
//   * `putResult` resolves `'created' | 'conflict'` from `ON CONFLICT DO
//     NOTHING ... RETURNING`, so a handler never sees SQLSTATE 23505.
//
// Table names are qualified with `env.RRETHI_PG_SCHEMA` (default `public`) so
// the conformance suite can run against a throwaway schema on a real project.

import { readFile } from "node:fs/promises";

import {
  assertDateKey,
  assertKey,
  assertPositiveInteger,
  foreignKeyError,
  normalizeResultInput,
  storeError,
} from "./store.js";

/** Postgres SQLSTATE for a foreign-key violation. */
const FOREIGN_KEY_VIOLATION = "23503";
/** CHECK / NOT NULL violations — shared validation should have caught these. */
const CONSTRAINT_VIOLATIONS = new Set(["23502", "23514"]);

const SCHEMA_PATTERN = /^[a-z_][a-z0-9_]{0,42}$/u;

/** Every schema-scoped object in schema.sql; see `rewriteSchemaStatements`. */
const SCHEMA_OBJECTS = ["member", "circle", "membership", "result", "rate_bucket"];

/** `TIMESTAMPTZ` -> `2026-08-01T21:04:05.123Z`, formatted server-side. */
const ISO_UTC = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;

/** @param {string} column @param {string} [alias] */
function isoUtc(column, alias) {
  return `to_char(${column} AT TIME ZONE 'UTC', ${ISO_UTC}) AS ${alias ?? column.split(".").pop()}`;
}

/**
 * @param {Record<string, string|undefined>} env
 * @returns {string}
 */
export function resolveConnectionString(env) {
  const url = env?.NEON_DATABASE_URL ?? env?.DATABASE_URL ?? env?.POSTGRES_URL;
  if (typeof url !== "string" || url === "") {
    throw storeError(
      "the neon adapter needs NEON_DATABASE_URL (or DATABASE_URL / POSTGRES_URL)",
    );
  }
  return url;
}

/**
 * @param {Record<string, string|undefined>} env
 * @returns {string}
 */
export function resolveSchema(env) {
  const schema = String(env?.RRETHI_PG_SCHEMA ?? "public").trim() || "public";
  if (!SCHEMA_PATTERN.test(schema)) {
    // The schema name is interpolated into SQL (identifiers cannot be bound as
    // parameters), so it is validated rather than escaped.
    throw storeError(`invalid RRETHI_PG_SCHEMA ${JSON.stringify(schema)}`);
  }
  return schema;
}

/**
 * Lazily loads the driver. The only place `@neondatabase/serverless` is
 * referenced.
 *
 * @param {Record<string, string|undefined>} env
 */
async function connect(env) {
  const connectionString = resolveConnectionString(env);
  let neon;
  try {
    ({ neon } = await import("@neondatabase/serverless"));
  } catch (cause) {
    throw storeError(
      "the neon adapter needs @neondatabase/serverless installed (npm install)",
      cause,
    );
  }
  const sql = neon(connectionString);
  if (typeof sql.query !== "function") {
    throw storeError("@neondatabase/serverless is too old: sql.query() is missing");
  }
  return sql;
}

/** @param {unknown} error */
function mapError(error) {
  const code = error?.code;
  if (code === FOREIGN_KEY_VIOLATION) return foreignKeyError(error);
  if (CONSTRAINT_VIOLATIONS.has(code)) {
    return storeError("value violates a stored constraint", error);
  }
  return storeError("database error", error);
}

/**
 * Runs one parameterised statement and returns plain rows. Every driver error
 * is translated here, so no `NeonDbError` reaches a caller.
 *
 * @param {{query: Function}} sql
 * @param {string} text
 * @param {unknown[]} [params]
 * @returns {Promise<Record<string, unknown>[]>}
 */
async function run(sql, text, params = []) {
  let output;
  try {
    output = await sql.query(text, params);
  } catch (error) {
    throw mapError(error);
  }
  if (Array.isArray(output)) return output;
  return Array.isArray(output?.rows) ? output.rows : [];
}

/** Postgres may hand back `t`/`f` depending on driver options. */
function toBoolean(value) {
  return value === true || value === "t" || value === "true";
}

function toNullableInteger(value) {
  return value === null || value === undefined ? null : Number(value);
}

function toMember(row) {
  return {
    memberKey: row.member_key,
    displayName: row.display_name,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  };
}

function toCircle(row) {
  return {
    code: row.code,
    name: row.name,
    ownerKey: row.owner_key,
    showTime: toBoolean(row.show_time),
    createdAt: row.created_at,
  };
}

function toResult(row) {
  return {
    circleCode: row.circle_code,
    memberKey: row.member_key,
    playDate: row.play_date,
    attempts: toNullableInteger(row.attempts),
    besa: toBoolean(row.besa),
    hint: toBoolean(row.hint),
    seconds: toNullableInteger(row.seconds),
    createdAt: row.created_at,
  };
}

/**
 * Rewrites `schema.sql` for a target schema and splits it into statements.
 *
 * Exported because it is the isolation guarantee the conformance suite relies
 * on: `schema.sql` qualifies every object as `public.`, and a test run must
 * rewrite all of them or it would create tables in a real project's `public`
 * schema. The suite asserts on this function directly, with no database.
 *
 * `--` comments are stripped before splitting on `;`; `schema.sql` documents
 * that it must contain no dollar-quoted bodies and no `;` or `--` inside
 * literals, which is what makes that safe.
 *
 * @param {string} sqlText
 * @param {string} schema
 * @returns {string[]}
 */
export function rewriteSchemaStatements(sqlText, schema) {
  if (!SCHEMA_PATTERN.test(schema)) {
    throw storeError(`invalid schema name ${JSON.stringify(schema)}`);
  }
  const withoutComments = String(sqlText).replace(/--[^\n]*/gu, "");
  for (const name of SCHEMA_OBJECTS) {
    // A reference not preceded by `public.` would be created in whatever
    // search_path the connection happens to have — i.e. a real project's
    // tables. `\b` keeps `member_key` and `result_circle_date_idx` out of it.
    const unqualified = new RegExp(String.raw`(?:^|[^.\w"])${name}\b`, "iu");
    if (unqualified.test(withoutComments)) {
      throw storeError(`schema.sql references ${name} without the public. prefix`);
    }
  }
  const statements = withoutComments
    .replaceAll("public.", `"${schema}".`)
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement !== "");
  if (statements.length === 0) {
    throw storeError("schema.sql produced no statements");
  }
  return statements;
}

/**
 * Applies `schema.sql` (creating the schema first when it is not `public`).
 * Idempotent: every statement is `IF NOT EXISTS`, so re-running is a no-op.
 *
 * @param {Record<string, string|undefined>} env
 * @returns {Promise<{schema: string, statements: number}>}
 */
export async function applyNeonSchema(env) {
  const schema = resolveSchema(env);
  const sql = await connect(env);
  const sqlText = await readFile(new URL("./schema.sql", import.meta.url), "utf8");
  if (schema !== "public") {
    await run(sql, `CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  }
  const statements = rewriteSchemaStatements(sqlText, schema);
  for (const statement of statements) {
    await run(sql, statement);
  }
  return { schema, statements: statements.length };
}

/**
 * Drops a throwaway schema created by `applyNeonSchema`. Refuses `public`, so
 * a mistyped env var cannot delete a real project's tables.
 *
 * @param {Record<string, string|undefined>} env
 * @returns {Promise<void>}
 */
export async function dropNeonSchema(env) {
  const schema = resolveSchema(env);
  if (schema === "public") {
    throw storeError("refusing to drop the public schema");
  }
  const sql = await connect(env);
  await run(sql, `DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
}

/**
 * @param {Record<string, string|undefined>} env
 * @returns {Promise<import("./store.js").RrethiStore>}
 */
export async function createNeonStore(env) {
  const schema = resolveSchema(env);
  const sql = await connect(env);
  /** @param {string} name */
  const t = (name) => `"${schema}".${name}`;

  const MEMBER_COLUMNS = `member_key, display_name, ${isoUtc("created_at")}, ${isoUtc("last_seen_at")}`;
  const CIRCLE_COLUMNS = `code, name, owner_key, show_time, ${isoUtc("created_at")}`;
  const RESULT_COLUMNS =
    `circle_code, member_key, to_char(play_date, 'YYYY-MM-DD') AS play_date, ` +
    `attempts, besa, hint, seconds, ${isoUtc("created_at")}`;

  return {
    async createMember(key, name) {
      assertKey(key, "memberKey");
      assertKey(name, "displayName");
      await run(
        sql,
        `INSERT INTO ${t("member")} (member_key, display_name, created_at, last_seen_at)
         VALUES ($1, $2, now(), now())
         ON CONFLICT (member_key) DO NOTHING`,
        [key, name],
      );
    },

    async getMember(key) {
      assertKey(key, "memberKey");
      const rows = await run(
        sql,
        `SELECT ${MEMBER_COLUMNS} FROM ${t("member")} WHERE member_key = $1`,
        [key],
      );
      return rows.length === 0 ? null : toMember(rows[0]);
    },

    async renameMember(key, name) {
      assertKey(key, "memberKey");
      assertKey(name, "displayName");
      await run(
        sql,
        `UPDATE ${t("member")} SET display_name = $2 WHERE member_key = $1`,
        [key, name],
      );
    },

    async deleteMember(key) {
      assertKey(key, "memberKey");
      // Cascades to membership, to the results reached through it, and to the
      // circles this member owns (schema.sql: circle.owner_key ON DELETE CASCADE).
      await run(sql, `DELETE FROM ${t("member")} WHERE member_key = $1`, [key]);
    },

    async createCircle(code, name, owner) {
      assertKey(code, "circleCode");
      assertKey(name, "circleName");
      assertKey(owner, "ownerKey");
      await run(
        sql,
        `INSERT INTO ${t("circle")} (code, name, owner_key, show_time, created_at)
         VALUES ($1, $2, $3, FALSE, now())
         ON CONFLICT (code) DO NOTHING`,
        [code, name, owner],
      );
    },

    async getCircle(code) {
      assertKey(code, "circleCode");
      const rows = await run(
        sql,
        `SELECT ${CIRCLE_COLUMNS} FROM ${t("circle")} WHERE code = $1`,
        [code],
      );
      return rows.length === 0 ? null : toCircle(rows[0]);
    },

    async addMembership(code, key) {
      assertKey(code, "circleCode");
      assertKey(key, "memberKey");
      await run(
        sql,
        `INSERT INTO ${t("membership")} (circle_code, member_key, joined_at)
         VALUES ($1, $2, now())
         ON CONFLICT (circle_code, member_key) DO NOTHING`,
        [code, key],
      );
    },

    async removeMembership(code, key) {
      assertKey(code, "circleCode");
      assertKey(key, "memberKey");
      // Cascades this member's results in this circle only.
      await run(
        sql,
        `DELETE FROM ${t("membership")} WHERE circle_code = $1 AND member_key = $2`,
        [code, key],
      );
    },

    async listCirclesFor(key) {
      assertKey(key, "memberKey");
      const rows = await run(
        sql,
        `SELECT c.code, c.name, c.owner_key, c.show_time, ${isoUtc("c.created_at", "created_at")}
           FROM ${t("membership")} m
           JOIN ${t("circle")} c ON c.code = m.circle_code
          WHERE m.member_key = $1
          ORDER BY m.joined_at ASC, c.code ASC`,
        [key],
      );
      return rows.map(toCircle);
    },

    async listMembers(code) {
      assertKey(code, "circleCode");
      const rows = await run(
        sql,
        `SELECT p.member_key, p.display_name,
                ${isoUtc("p.created_at", "created_at")},
                ${isoUtc("p.last_seen_at", "last_seen_at")}
           FROM ${t("membership")} m
           JOIN ${t("member")} p ON p.member_key = m.member_key
          WHERE m.circle_code = $1
          ORDER BY m.joined_at ASC, p.member_key ASC`,
        [code],
      );
      return rows.map(toMember);
    },

    async putResult(result) {
      const row = normalizeResultInput(result);
      const rows = await run(
        sql,
        `INSERT INTO ${t("result")}
           (circle_code, member_key, play_date, attempts, besa, hint, seconds, created_at)
         VALUES ($1, $2, $3::date, $4::smallint, $5::boolean, $6::boolean, $7::integer, now())
         ON CONFLICT (circle_code, member_key, play_date) DO NOTHING
         RETURNING 1 AS inserted`,
        [
          row.circleCode,
          row.memberKey,
          row.playDate,
          row.attempts,
          row.besa,
          row.hint,
          row.seconds,
        ],
      );
      // DO NOTHING returns no row when the primary key already exists, which is
      // exactly first-write-wins: the stored row is never updated.
      return rows.length > 0 ? "created" : "conflict";
    },

    async listResults(code, date) {
      assertKey(code, "circleCode");
      assertDateKey(date, "playDate");
      const rows = await run(
        sql,
        `SELECT ${RESULT_COLUMNS} FROM ${t("result")}
          WHERE circle_code = $1 AND play_date = $2::date
          ORDER BY attempts ASC NULLS LAST, member_key ASC`,
        [code, date],
      );
      return rows.map(toResult);
    },

    async listResultRange(code, from, to) {
      assertKey(code, "circleCode");
      assertDateKey(from, "from");
      assertDateKey(to, "to");
      const rows = await run(
        sql,
        `SELECT ${RESULT_COLUMNS} FROM ${t("result")}
          WHERE circle_code = $1 AND play_date BETWEEN $2::date AND $3::date
          ORDER BY play_date ASC, member_key ASC`,
        [code, from, to],
      );
      return rows.map(toResult);
    },

    async takeToken(bucket, limit, windowMs) {
      assertKey(bucket, "bucketKey");
      assertPositiveInteger(limit, "limit");
      assertPositiveInteger(windowMs, "windowMs");
      // One atomic upsert: the window rolls over when it has fully elapsed,
      // otherwise the counter advances. Identical arithmetic to the memory
      // adapter's `now - windowStart >= windowMs`.
      const expired = `b.window_start <= now() - make_interval(secs => $2::double precision / 1000.0)`;
      const rows = await run(
        sql,
        `INSERT INTO ${t("rate_bucket")} AS b (bucket_key, count, window_start)
         VALUES ($1, 1, now())
         ON CONFLICT (bucket_key) DO UPDATE
            SET count = CASE WHEN ${expired} THEN 1 ELSE b.count + 1 END,
                window_start = CASE WHEN ${expired} THEN now() ELSE b.window_start END
         RETURNING count`,
        [bucket, windowMs],
      );
      const count = Number(rows[0]?.count ?? 0);
      return count > 0 && count <= limit;
    },
  };
}
