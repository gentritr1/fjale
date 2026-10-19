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
  CIRCLE_MAX_MEMBERS,
  assertDateKey,
  assertDateRange,
  assertKey,
  assertPositiveInteger,
  foreignKeyError,
  normalizeResultInput,
  storeError,
} from "./store.js";

/** Postgres SQLSTATE for a foreign-key violation. */
const FOREIGN_KEY_VIOLATION = "23503";
/** Postgres SQLSTATE for a unique-index violation — `claimSeat`'s retry signal. */
const UNIQUE_VIOLATION = "23505";
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
async function connect(env, options = undefined) {
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
  const sql = neon(connectionString, options);
  if (typeof sql.query !== "function") {
    throw storeError("@neondatabase/serverless is too old: sql.query() is missing");
  }
  return sql;
}

/**
 * Read-only readiness probe used only by the explicit deep health check.
 * It verifies both connectivity and the five Rrethi tables without returning
 * the schema name or any database metadata to the public endpoint.
 *
 * @param {Record<string, string|undefined>} env
 * @param {number} [timeoutMs]
 * @returns {Promise<{schemaReady: boolean}>}
 */
export async function checkNeonHealth(env, timeoutMs = 5_000) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
    throw storeError("invalid Neon health timeout");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const schema = resolveSchema(env);
    const sql = await connect(env, { fetchOptions: { signal: controller.signal } });
    const rows = await run(
      sql,
      `SELECT count(*)::integer AS table_count
         FROM information_schema.tables
        WHERE table_schema = $1
          AND table_name IN ('member', 'circle', 'membership', 'result', 'rate_bucket')`,
      [schema],
    );
    return { schemaReady: Number(rows[0]?.table_count) === SCHEMA_OBJECTS.length };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Which unique index a 23505 came from: the seat index (a lost seat race, so
 * retry) or the membership primary key (this member raced themselves).
 * The driver exposes `constraint`; when it does not, the safe reading is the
 * seat index, because a primary-key collision is already absorbed by
 * `ON CONFLICT (circle_code, member_key) DO NOTHING` and so should not surface
 * here at all — and a retry converges, while a wrong `'conflict'` would report
 * a member as seated when they are not.
 *
 * @param {unknown} error
 */
function isSeatIndexViolation(error) {
  const constraint = String(error?.constraint ?? "");
  return constraint === "" || constraint.includes("seat");
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
    avatarId: row.avatar_id,
    letterSeal: row.letter_seal,
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

  const MEMBER_COLUMNS =
    `member_key, display_name, avatar_id, letter_seal, ` +
    `${isoUtc("created_at")}, ${isoUtc("last_seen_at")}`;

  /**
   * Lowest unoccupied seat in `1..$n`, evaluated inside the INSERT so no seat
   * number is ever chosen by a handler. See the memory adapter's
   * `lowestFreeSeat` for why this is lowest-free and not `MAX(seat) + 1`
   * (deviation D7).
   */
  const lowestFreeSeatSql = (limitParam) =>
    `(SELECT MIN(s.n) FROM generate_series(1, ${limitParam}::smallint) AS s(n)
       WHERE NOT EXISTS (SELECT 1 FROM ${t("membership")} taken
                          WHERE taken.circle_code = c.code AND taken.seat = s.n))`;

  /**
   * Runs only when `claimSeat`'s insert produced no row, and answers which of
   * its guards refused. The order is the contract's: a missing circle first,
   * then an existing membership (so an existing member re-joining a circle that
   * has since filled reads as an idempotent `'conflict'`, never as `'full'`),
   * then the per-member circle cap, and `'full'` as the remainder.
   */
  async function disambiguateClaim(code, key, maxCircles) {
    const rows = await run(
      sql,
      `SELECT (SELECT COUNT(*) FROM ${t("circle")} c WHERE c.code = $1) AS circle_count,
              (SELECT COUNT(*) FROM ${t("membership")} m
                WHERE m.circle_code = $1 AND m.member_key = $2) AS membership_count,
              (SELECT COUNT(*) FROM ${t("membership")} m
                WHERE m.member_key = $2) AS circles_joined`,
      [code, key],
    );
    const row = rows[0] ?? {};
    if (Number(row.circle_count ?? 0) === 0) return "missing";
    if (Number(row.membership_count ?? 0) > 0) return "conflict";
    if (Number(row.circles_joined ?? 0) >= maxCircles) return "over_circle_limit";
    return "full";
  }
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
      const rows = await run(
        sql,
        `INSERT INTO ${t("circle")} (code, name, owner_key, show_time, created_at)
         VALUES ($1, $2, $3, FALSE, now())
         ON CONFLICT (code) DO NOTHING
         RETURNING 1 AS inserted`,
        [code, name, owner],
      );
      return rows.length > 0 ? "created" : "conflict";
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
      // `seat` is NOT NULL, so even the narrow primitive assigns one. It applies
      // no caps — that is `claimSeat`'s job — but a circle with no free seat
      // yields a NULL seat and so a NOT NULL violation, mapped by `mapError`
      // to the same "stored constraint" error the memory adapter raises.
      const rows = await run(
        sql,
        `INSERT INTO ${t("membership")} (circle_code, member_key, seat, joined_at)
         SELECT c.code, $2, ${lowestFreeSeatSql(String(CIRCLE_MAX_MEMBERS))}, now()
           FROM ${t("circle")} c
          WHERE c.code = $1
         ON CONFLICT (circle_code, member_key) DO NOTHING
         RETURNING 1 AS inserted`,
        [code, key],
      );
      if (rows.length > 0) return "created";
      // Zero rows means either the ON CONFLICT fired or the circle does not
      // exist. M0 semantics: a missing circle throws the foreign-key error.
      const existing = await run(
        sql,
        `SELECT 1 AS found FROM ${t("membership")}
          WHERE circle_code = $1 AND member_key = $2`,
        [code, key],
      );
      if (existing.length > 0) return "conflict";
      throw foreignKeyError();
    },

    async claimSeat(code, key, maxSeats, maxCircles) {
      assertKey(code, "circleCode");
      assertKey(key, "memberKey");
      assertPositiveInteger(maxSeats, "maxSeats");
      assertPositiveInteger(maxCircles, "maxCircles");
      if (maxSeats > CIRCLE_MAX_MEMBERS) {
        throw storeError(`maxSeats must be at most ${CIRCLE_MAX_MEMBERS}`);
      }

      // One statement. Concurrency is resolved by membership_circle_seat_idx,
      // never by a count this process read a moment ago (plan §4.2).
      const insert =
        `INSERT INTO ${t("membership")} (circle_code, member_key, seat, joined_at)
         SELECT c.code, $2, ${lowestFreeSeatSql("$3")}, now()
           FROM ${t("circle")} c
          WHERE c.code = $1
            AND (SELECT COUNT(*) FROM ${t("membership")} m
                  WHERE m.circle_code = c.code) < $3
            AND (SELECT COUNT(*) FROM ${t("membership")} m
                  WHERE m.member_key = $2) < $4
         ON CONFLICT (circle_code, member_key) DO NOTHING
         RETURNING seat`;

      // Five attempts is for the lottery, not the common case: with a ten-seat
      // ceiling, five consecutive losses of the same seat race is unreachable,
      // so exhausting them must be loud rather than silently reported as full.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        let rows;
        try {
          const output = await sql.query(insert, [code, key, maxSeats, maxCircles]);
          rows = Array.isArray(output) ? output : (output?.rows ?? []);
        } catch (error) {
          if (error?.code === UNIQUE_VIOLATION && isSeatIndexViolation(error)) {
            // A concurrent join took the seat this statement computed. Retrying
            // re-evaluates both count guards, so a loser converges to 'full'
            // when the circle filled and to a higher seat when it did not.
            continue;
          }
          if (error?.code === UNIQUE_VIOLATION) {
            // The primary key: this member raced themselves (an outbox double
            // flush). ON CONFLICT normally absorbs it; this is the backstop.
            return "conflict";
          }
          throw mapError(error);
        }
        if (rows.length > 0) return "created";

        // Zero rows and no error: one read on the failure path only decides
        // which guard refused. The happy path stays a single round trip.
        return disambiguateClaim(code, key, maxCircles);
      }
      throw storeError("seat contention");
    },

    async upsertMember(key, profile) {
      assertKey(key, "memberKey");
      if (profile === null || typeof profile !== "object") {
        throw storeError("profile must be an object");
      }
      const displayName = assertKey(profile.displayName, "displayName");
      const avatarId = assertKey(profile.avatarId, "avatarId");
      const letterSeal = assertKey(profile.letterSeal, "letterSeal");
      // `xmax = 0` is true only for a row this statement inserted, which is how
      // one upsert reports which of the two things happened. created_at and
      // last_seen_at are left alone on the update path: an edit is not a visit.
      const rows = await run(
        sql,
        `INSERT INTO ${t("member")}
           (member_key, display_name, avatar_id, letter_seal, created_at, last_seen_at)
         VALUES ($1, $2, $3, $4, now(), now())
         ON CONFLICT (member_key) DO UPDATE
            SET display_name = EXCLUDED.display_name,
                avatar_id = EXCLUDED.avatar_id,
                letter_seal = EXCLUDED.letter_seal
         RETURNING (xmax = 0) AS created`,
        [key, displayName, avatarId, letterSeal],
      );
      return toBoolean(rows[0]?.created) ? "created" : "updated";
    },

    async touchMember(key) {
      assertKey(key, "memberKey");
      // A no-op on an unknown key, matching renameMember.
      await run(
        sql,
        `UPDATE ${t("member")} SET last_seen_at = now() WHERE member_key = $1`,
        [key],
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
      const range = assertDateRange(from, to);
      const rows = await run(
        sql,
        `SELECT ${RESULT_COLUMNS} FROM ${t("result")}
          WHERE circle_code = $1 AND play_date BETWEEN $2::date AND $3::date
          ORDER BY play_date ASC, member_key ASC`,
        [code, range.from, range.to],
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
