// ONE conformance suite for every RrethiStore adapter — PLAN-RRETHI-2026-08.md
// §2.9 ("one conformance suite ... passing it is the definition of shippable")
// and §2.12 M0.
//
// Running it:
//
//   npm test                                   memory only; the Neon block is
//                                              reported as skipped, with the
//                                              reason printed by the reporter.
//   RRETHI_TEST_NEON_URL='postgres://user:pass@host/db?sslmode=require' npm test
//                                              runs the identical assertions
//                                              against Neon as well.
//
// The suite deliberately reads RRETHI_TEST_NEON_URL — its own variable — and
// NOT the production NEON_DATABASE_URL. `npm run dev` auto-loads `.env`, which
// holds the production URL; a shared name would aim this schema-creating,
// compute-burning suite at production the first time someone adds --env-file
// to the test script or exports the var. Point the test variable at a scratch
// Neon project.
//
// The second form needs no code change and no manual migration: the suite
// generates a throwaway Postgres schema (`rrethi_test_<random>`), applies
// `api/_lib/schema.sql` into it via `applyNeonSchema`, and drops it CASCADE
// when the test finishes, pass or fail. `schema.sql` qualifies every object as
// `public.` and the loader rewrites that prefix, so a run against a real Neon
// project cannot create, read, or drop anything in `public` — `dropNeonSchema`
// refuses the name `public` outright, and "the rewrite covers every object" is
// itself asserted below, with no database required.
//
// Nothing on the default path touches `node_modules`: the Neon adapter and its
// driver are only reached through dynamic `import()` inside the gated block, so
// `rm -rf node_modules && npm test` is green.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

import { createStore } from "../api/_lib/store.js";

const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

const NEON_URL = process.env.RRETHI_TEST_NEON_URL ?? "";
const TEST_SCHEMA = `rrethi_test_${randomBytes(6).toString("hex")}`;

const ADAPTERS = [
  {
    name: "memory",
    skip: false,
    async create() {
      const store = await createStore({ RRETHI_STORE: "memory" });
      return { store, async destroy() {} };
    },
  },
  {
    name: "neon",
    skip:
      NEON_URL === ""
        ? "RRETHI_TEST_NEON_URL is not set — run `RRETHI_TEST_NEON_URL=postgres://… npm test` " +
          "against a SCRATCH Neon project to run this same suite there " +
          "(it creates and drops its own schema)"
        : false,
    async create() {
      const env = {
        RRETHI_STORE: "neon",
        NEON_DATABASE_URL: NEON_URL,
        RRETHI_PG_SCHEMA: TEST_SCHEMA,
      };
      const { applyNeonSchema, dropNeonSchema } = await import("../api/_lib/store-neon.js");
      await applyNeonSchema(env);
      // Idempotence (plan §2.12: "re-running it is a no-op").
      await applyNeonSchema(env);
      const store = await createStore(env);
      return { store, destroy: () => dropNeonSchema(env) };
    },
  },
];

/** A loss is `null` attempts; every other value here is a real 1..6 win. */
function result(circleCode, memberKey, playDate, attempts, extra = {}) {
  return { circleCode, memberKey, playDate, attempts, besa: false, hint: false, ...extra };
}

async function seedCircle(store, code, members) {
  await store.createMember(members[0], `Owner of ${code}`);
  await store.createCircle(code, `Rrethi ${code}`, members[0]);
  for (const key of members) {
    if (key !== members[0]) await store.createMember(key, `Player ${key}`);
    await store.addMembership(code, key);
  }
}

/**
 * The identical assertions every adapter must satisfy. Keys are prefixed per
 * section so the sections stay independent inside one shared store.
 *
 * @param {import("node:test").TestContext} t
 * @param {import("../api/_lib/store.js").RrethiStore} store
 */
async function runConformance(t, store) {
  await t.test("member: create, get, rename, delete", async () => {
    assert.equal(await store.getMember("m1-absent"), null);

    await store.createMember("m1-alba", "Alba");
    const created = await store.getMember("m1-alba");
    assert.equal(created.memberKey, "m1-alba");
    assert.equal(created.displayName, "Alba");
    assert.match(created.createdAt, ISO_UTC_PATTERN);
    assert.match(created.lastSeenAt, ISO_UTC_PATTERN);

    // Insert-if-absent: a second create never overwrites the display name.
    await store.createMember("m1-alba", "Dikush tjetër");
    assert.equal((await store.getMember("m1-alba")).displayName, "Alba");

    await store.renameMember("m1-alba", "Alba R.");
    assert.equal((await store.getMember("m1-alba")).displayName, "Alba R.");

    // Renaming an unknown member is a no-op, not an error.
    await store.renameMember("m1-absent", "Fantazmë");
    assert.equal(await store.getMember("m1-absent"), null);

    await store.deleteMember("m1-alba");
    assert.equal(await store.getMember("m1-alba"), null);
    // Deleting twice is idempotent (DELETE /api/rrethi/me returns 204 twice).
    await store.deleteMember("m1-alba");
  });

  await t.test("shared boundary rejects ambiguous or unbounded text", async () => {
    await assert.rejects(() => store.createMember("m-safe\u0000collision", "Emër"), /control/u);
    await assert.rejects(() => store.createMember("m-safe-newline", "Emër\nTjetër"), /control/u);
    await assert.rejects(() => store.createMember("   ", "Emër"), /non-empty/u);
    await assert.rejects(() => store.createMember("m-safe-long", "x".repeat(257)), /256/u);
  });

  await t.test("circle: create and get", async () => {
    assert.equal(await store.getCircle("RR-C2ABSENT"), null);

    await store.createMember("m2-owner", "Zotëruesi");
    // Discriminated create, same shape as putResult: M1's circle-code generator
    // retries on 'conflict' instead of racing a read-then-insert.
    assert.equal(await store.createCircle("RR-C2FAMILJ", "Familja", "m2-owner"), "created");
    const circle = await store.getCircle("RR-C2FAMILJ");
    assert.equal(circle.code, "RR-C2FAMILJ");
    assert.equal(circle.name, "Familja");
    assert.equal(circle.ownerKey, "m2-owner");
    assert.equal(circle.showTime, false); // plan §2.3: time is off by default
    assert.match(circle.createdAt, ISO_UTC_PATTERN);

    // Insert-if-absent: an existing code is never silently renamed or re-owned,
    // and the collision is reported, not swallowed.
    assert.equal(await store.createCircle("RR-C2FAMILJ", "Tjetër", "m2-owner"), "conflict");
    assert.equal((await store.getCircle("RR-C2FAMILJ")).name, "Familja");
    // The conflict is resolved before the owner foreign key: Postgres fires no
    // FK trigger for a row it does not insert, so this must not throw.
    assert.equal(await store.createCircle("RR-C2FAMILJ", "Tjetër", "m2-nobody"), "conflict");
    assert.equal((await store.getCircle("RR-C2FAMILJ")).ownerKey, "m2-owner");

    await assert.rejects(
      () => store.createCircle("RR-C2ORPHAN", "Pa zotërues", "m2-nobody"),
      /foreign key/u,
    );
    assert.equal(await store.getCircle("RR-C2ORPHAN"), null);
  });

  await t.test("membership: add, remove, list", async () => {
    await seedCircle(store, "RR-C3ONE", ["m3-a", "m3-b"]);
    await store.createMember("m3-c", "C");

    assert.deepEqual(
      (await store.listMembers("RR-C3ONE")).map((row) => row.memberKey),
      ["m3-a", "m3-b"],
    );
    // Idempotent join, reported as a conflict: M1's seat-cap check needs to
    // distinguish "joined" from "was already in".
    assert.equal(await store.addMembership("RR-C3ONE", "m3-b"), "conflict");
    assert.equal((await store.listMembers("RR-C3ONE")).length, 2);

    await store.createCircle("RR-C3TWO", "I dyti", "m3-a");
    assert.equal(await store.addMembership("RR-C3TWO", "m3-a"), "created");
    assert.deepEqual(
      (await store.listCirclesFor("m3-a")).map((row) => row.code),
      ["RR-C3ONE", "RR-C3TWO"],
    );
    assert.deepEqual(await store.listCirclesFor("m3-c"), []);

    await assert.rejects(
      () => store.addMembership("RR-C3ABSENT", "m3-a"),
      /foreign key/u,
    );
    await assert.rejects(() => store.addMembership("RR-C3ONE", "m3-absent"), /foreign key/u);

    await store.removeMembership("RR-C3ONE", "m3-b");
    assert.deepEqual(
      (await store.listMembers("RR-C3ONE")).map((row) => row.memberKey),
      ["m3-a"],
    );
    assert.deepEqual(await store.listCirclesFor("m3-b"), []);
    // Leaving twice is a no-op.
    await store.removeMembership("RR-C3ONE", "m3-b");
  });

  await t.test("putResult: first write wins, second is a conflict", async () => {
    await seedCircle(store, "RR-C4WIN", ["m4-a", "m4-b"]);

    assert.equal(
      await store.putResult(result("RR-C4WIN", "m4-a", "2026-08-03", 3, { besa: true })),
      "created",
    );
    assert.equal(
      await store.putResult(
        result("RR-C4WIN", "m4-a", "2026-08-03", 6, { besa: false, hint: true, seconds: 99 }),
      ),
      "conflict",
    );

    // §2.12 M0 acceptance: the stored row is the FIRST one, unchanged.
    const rows = await store.listResults("RR-C4WIN", "2026-08-03");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].attempts, 3);
    assert.equal(rows[0].besa, true);
    assert.equal(rows[0].hint, false);
    assert.equal(rows[0].seconds, null);

    // A different date and a different member are separate rows.
    assert.equal(
      await store.putResult(result("RR-C4WIN", "m4-a", "2026-08-04", 2)),
      "created",
    );
    assert.equal(
      await store.putResult(result("RR-C4WIN", "m4-b", "2026-08-03", 2)),
      "created",
    );

    // Writing into a circle you are not a member of is refused.
    await store.createMember("m4-outsider", "I huaj");
    await assert.rejects(
      () => store.putResult(result("RR-C4WIN", "m4-outsider", "2026-08-03", 1)),
      /foreign key/u,
    );
  });

  await t.test("result: attempts 1..6 and NULL-for-loss round-trip", async () => {
    const members = ["m5-1", "m5-2", "m5-3", "m5-4", "m5-5", "m5-6", "m5-x"];
    await seedCircle(store, "RR-C5ATT", members);
    for (let attempts = 1; attempts <= 6; attempts += 1) {
      await store.putResult(result("RR-C5ATT", `m5-${attempts}`, "2026-08-05", attempts));
    }
    await store.putResult(
      result("RR-C5ATT", "m5-x", "2026-08-05", null, { besa: true, hint: true, seconds: 0 }),
    );

    const rows = await store.listResults("RR-C5ATT", "2026-08-05");
    assert.equal(rows.length, 7);
    // Losses sort last (plan §2.3 "attempts ascending, losses last").
    assert.deepEqual(
      rows.map((row) => row.attempts),
      [1, 2, 3, 4, 5, 6, null],
    );
    for (const row of rows.slice(0, 6)) assert.equal(typeof row.attempts, "number");
    const loss = rows[6];
    assert.equal(loss.attempts, null); // strict: not 0, not undefined
    assert.equal(loss.besa, true);
    assert.equal(loss.hint, true);
    assert.equal(loss.seconds, 0); // strict: 0 seconds is not "no time"

    // No driver type crosses the boundary.
    assert.equal(typeof loss.playDate, "string");
    assert.match(loss.playDate, DATE_KEY_PATTERN);
    assert.equal(loss.playDate, "2026-08-05");
    assert.match(loss.createdAt, ISO_UTC_PATTERN);

    await assert.rejects(
      () => store.putResult(result("RR-C5ATT", "m5-1", "2026-08-06", 0)),
      /attempts/u,
    );
    await assert.rejects(
      () => store.putResult(result("RR-C5ATT", "m5-1", "2026-08-06", 7)),
      /attempts/u,
    );
    await assert.rejects(
      () => store.putResult(result("RR-C5ATT", "m5-1", new Date("2026-08-06"), 3)),
      /YYYY-MM-DD/u,
    );
    await assert.rejects(
      () => store.putResult(result("RR-C5ATT", "m5-1", "2026-02-29", 3)),
      /calendar date/u,
    );
    await assert.rejects(
      () => store.putResult(result("RR-C5ATT", "m5-1", "0000-01-01", 3)),
      /calendar date/u,
    );
    await assert.rejects(
      () =>
        store.putResult(
          result("RR-C5ATT", "m5-1", "2026-08-06", 3, { seconds: 2_147_483_648 }),
        ),
      /seconds/u,
    );
    assert.deepEqual(await store.listResults("RR-C5ATT", "2026-08-06"), []);
  });

  await t.test("listResultRange: a Monday-to-Sunday week", async () => {
    await seedCircle(store, "RR-C6WEEK", ["m6-a", "m6-b"]);
    // 2026-08-03 is a Monday; 2026-08-09 the Sunday that closes the week.
    const days = [
      "2026-08-02", // Sunday before — outside
      "2026-08-03",
      "2026-08-05",
      "2026-08-09",
      "2026-08-10", // Monday after — outside
    ];
    for (const day of days) {
      await store.putResult(result("RR-C6WEEK", "m6-a", day, 4));
      await store.putResult(result("RR-C6WEEK", "m6-b", day, 5));
    }

    const week = await store.listResultRange("RR-C6WEEK", "2026-08-03", "2026-08-09");
    assert.equal(week.length, 6); // 3 days x 2 members; both bounds inclusive
    assert.deepEqual(
      week.map((row) => `${row.playDate}/${row.memberKey}`),
      [
        "2026-08-03/m6-a",
        "2026-08-03/m6-b",
        "2026-08-05/m6-a",
        "2026-08-05/m6-b",
        "2026-08-09/m6-a",
        "2026-08-09/m6-b",
      ],
    );
    assert.equal((await store.listResults("RR-C6WEEK", "2026-08-05")).length, 2);
    assert.deepEqual(await store.listResults("RR-C6WEEK", "2026-08-04"), []);
    // A single-day range is the same row set as listResults for that day.
    assert.equal(
      (await store.listResultRange("RR-C6WEEK", "2026-08-09", "2026-08-09")).length,
      2,
    );
    await assert.rejects(
      () => store.listResultRange("RR-C6WEEK", "2026-08-09", "2026-08-03"),
      /on or before/u,
    );
    // Unbounded ranges are refused before they reach the database: a crafted
    // "0001-01-01".."9999-12-31" request must never become a full-table scan
    // billed in Neon compute-seconds. 366 days (a leap year) is the ceiling.
    await assert.rejects(
      () => store.listResultRange("RR-C6WEEK", "0001-01-01", "9999-12-31"),
      /at most 366 days/u,
    );
    await assert.rejects(
      () => store.listResultRange("RR-C6WEEK", "2026-01-01", "2027-01-02"),
      /at most 366 days/u,
    );
    // A full leap-year span (366 days inclusive) is still allowed.
    assert.deepEqual(await store.listResultRange("RR-C6WEEK", "2024-01-01", "2024-12-31"), []);
  });

  await t.test("takeToken: allows `limit` calls per window, then refuses", async () => {
    const bucket = `b7-${randomBytes(4).toString("hex")}`;
    assert.equal(await store.takeToken(bucket, 3, 60_000), true);
    assert.equal(await store.takeToken(bucket, 3, 60_000), true);
    assert.equal(await store.takeToken(bucket, 3, 60_000), true);
    assert.equal(await store.takeToken(bucket, 3, 60_000), false);
    assert.equal(await store.takeToken(bucket, 3, 60_000), false);

    // Buckets are independent.
    assert.equal(await store.takeToken(`${bucket}-other`, 1, 60_000), true);
    await assert.rejects(
      () => store.takeToken(`${bucket}-unsafe`, Number.MAX_SAFE_INTEGER + 1, 60_000),
      /safe integer/u,
    );

    // The window rolls over: refused, then allowed again once it has elapsed.
    const rolling = `b7-roll-${randomBytes(4).toString("hex")}`;
    assert.equal(await store.takeToken(rolling, 1, 1_000), true);
    assert.equal(await store.takeToken(rolling, 1, 1_000), false);
    await delay(1_200);
    assert.equal(await store.takeToken(rolling, 1, 1_000), true);
  });

  await t.test("cascade: deleting a member clears their results from the board", async () => {
    await seedCircle(store, "RR-C8HOME", ["m8-a", "m8-b"]);
    await seedCircle(store, "RR-C8WORK", ["m8-a", "m8-b"]);
    for (const code of ["RR-C8HOME", "RR-C8WORK"]) {
      await store.putResult(result(code, "m8-a", "2026-08-07", 3));
      await store.putResult(result(code, "m8-b", "2026-08-07", 4));
    }

    // Leaving one circle cascades that member's results in that circle only.
    await store.removeMembership("RR-C8HOME", "m8-b");
    assert.deepEqual(
      (await store.listResults("RR-C8HOME", "2026-08-07")).map((row) => row.memberKey),
      ["m8-a"],
    );
    assert.equal((await store.listResults("RR-C8WORK", "2026-08-07")).length, 2);

    // Deleting the member removes them from every board at once.
    await store.deleteMember("m8-b");
    assert.equal(await store.getMember("m8-b"), null);
    assert.deepEqual(
      (await store.listResults("RR-C8WORK", "2026-08-07")).map((row) => row.memberKey),
      ["m8-a"],
    );
    assert.deepEqual(
      (await store.listMembers("RR-C8WORK")).map((row) => row.memberKey),
      ["m8-a"],
    );
    // Everyone else's results survive.
    assert.equal((await store.listResults("RR-C8HOME", "2026-08-07")).length, 1);
  });

  await t.test("cascade: deleting an owner takes the circle with it", async () => {
    // schema.sql pins circle.owner_key to ON DELETE CASCADE so that a data
    // deletion can never be blocked by a foreign key (plan §2.10).
    await seedCircle(store, "RR-C9OWNED", ["m9-owner", "m9-guest"]);
    await store.putResult(result("RR-C9OWNED", "m9-guest", "2026-08-08", 2));

    await store.deleteMember("m9-owner");
    assert.equal(await store.getCircle("RR-C9OWNED"), null);
    assert.deepEqual(await store.listMembers("RR-C9OWNED"), []);
    assert.deepEqual(await store.listResults("RR-C9OWNED", "2026-08-08"), []);
    // The guest themself is untouched — only the circle went.
    assert.notEqual(await store.getMember("m9-guest"), null);
    assert.deepEqual(await store.listCirclesFor("m9-guest"), []);
  });
}

for (const adapter of ADAPTERS) {
  test(`RrethiStore conformance — ${adapter.name}`, { skip: adapter.skip }, async (t) => {
    const { store, destroy } = await adapter.create();
    try {
      await runConformance(t, store);
    } finally {
      await destroy();
    }
  });
}

test("createStore selects an adapter by RRETHI_STORE", async () => {
  const fallback = await createStore({});
  assert.equal(typeof fallback.putResult, "function");
  assert.equal(typeof (await createStore({ RRETHI_STORE: "memory" })).takeToken, "function");
  await assert.rejects(() => createStore({ RRETHI_STORE: "sqlite" }), /unknown RRETHI_STORE/u);
});

test("schema.sql is fully qualified, so a test run cannot touch public", async () => {
  // Guards the isolation the Neon block above depends on. No database needed,
  // so this runs on every `npm test` — including with node_modules deleted.
  const { rewriteSchemaStatements } = await import("../api/_lib/store-neon.js");
  const sqlText = await readFile(new URL("../api/_lib/schema.sql", import.meta.url), "utf8");

  const statements = rewriteSchemaStatements(sqlText, "rrethi_test_probe");
  assert.equal(statements.length, 9); // 5 tables + 4 indexes
  for (const statement of statements) {
    assert.doesNotMatch(statement, /public\./u);
    assert.match(statement, /IF NOT EXISTS/u); // re-running the file is a no-op
  }
  assert.equal(
    statements.filter((statement) => statement.includes(`"rrethi_test_probe".`)).length,
    9,
  );
  assert.match(
    statements.join(";"),
    /REFERENCES "rrethi_test_probe"\.membership \(circle_code, member_key\) ON DELETE CASCADE/u,
  );

  // An unqualified object name in schema.sql must fail loudly rather than
  // silently create tables in whatever schema the search_path points at.
  assert.throws(
    () => rewriteSchemaStatements("CREATE TABLE IF NOT EXISTS member (a TEXT);", "probe_schema"),
    /without the public\. prefix/u,
  );
  assert.throws(() => rewriteSchemaStatements(sqlText, "Bad-Schema"), /invalid schema name/u);
});
