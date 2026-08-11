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

  // --- M1 additions (PLAN-RRETHI-M1-API.md §7). Additive: nothing above changed.

  await t.test("upsertMember: creates, then updates all three profile fields", async () => {
    assert.equal(
      await store.upsertMember("m10-new", {
        displayName: "Besa",
        avatarId: "stick-racer",
        letterSeal: "ë",
      }),
      "created",
    );
    const created = await store.getMember("m10-new");
    assert.equal(created.displayName, "Besa");
    assert.equal(created.avatarId, "stick-racer");
    assert.equal(created.letterSeal, "ë");

    assert.equal(
      await store.upsertMember("m10-new", {
        displayName: "Besa K.",
        avatarId: "stick-runner",
        letterSeal: "ç",
      }),
      "updated",
    );
    const updated = await store.getMember("m10-new");
    assert.equal(updated.displayName, "Besa K.");
    assert.equal(updated.avatarId, "stick-runner");
    assert.equal(updated.letterSeal, "ç");
    // An edit is not a visit: created_at is untouched.
    assert.equal(updated.createdAt, created.createdAt);

    // createMember still fills the profile columns with the catalog defaults.
    await store.createMember("m10-narrow", "E ngushtë");
    const narrow = await store.getMember("m10-narrow");
    assert.equal(narrow.avatarId, "stick-racer");
    assert.equal(narrow.letterSeal, "ë");
  });

  await t.test("touchMember: advances last_seen_at, silent on an unknown key", async () => {
    await store.createMember("m11-seen", "Parë");
    const before = await store.getMember("m11-seen");
    await delay(5);
    await store.touchMember("m11-seen");
    const after = await store.getMember("m11-seen");
    assert.ok(after.lastSeenAt > before.lastSeenAt, `${after.lastSeenAt} !> ${before.lastSeenAt}`);
    assert.equal(after.createdAt, before.createdAt);

    // A no-op on an unknown key, matching renameMember.
    await store.touchMember("m11-absent");
    assert.equal(await store.getMember("m11-absent"), null);
  });

  await t.test("claimSeat: the five discriminated outcomes", async () => {
    // A mistyped invite code is an ordinary 404, so 'missing' is a value rather
    // than the foreign-key throw putResult uses.
    await store.createMember("m12-a", "Ana");
    assert.equal(await store.claimSeat("RR-C12ABSENT", "m12-a", 10, 10), "missing");

    await store.createCircle("RR-C12SEAT", "Familja", "m12-a");
    assert.equal(await store.claimSeat("RR-C12SEAT", "m12-a", 10, 10), "created");
    // Idempotent: a repeat join changes nothing and reports it.
    assert.equal(await store.claimSeat("RR-C12SEAT", "m12-a", 10, 10), "conflict");

    await store.createMember("m12-b", "Ben");
    assert.equal(await store.claimSeat("RR-C12SEAT", "m12-b", 2, 10), "created");
    await store.createMember("m12-c", "Cen");
    assert.equal(await store.claimSeat("RR-C12SEAT", "m12-c", 2, 10), "full");

    // An existing member re-joining a circle that has since filled must read as
    // an idempotent 'conflict', never as 'full'.
    assert.equal(await store.claimSeat("RR-C12SEAT", "m12-a", 2, 10), "conflict");

    // The per-member circle cap.
    await store.createCircle("RR-C12OTHER", "Tjetër", "m12-a");
    assert.equal(await store.claimSeat("RR-C12OTHER", "m12-b", 10, 1), "over_circle_limit");

    // The database CHECK is hard-coded at 10, so a larger argument is refused
    // up front rather than surfacing as a confusing constraint violation.
    await assert.rejects(() => store.claimSeat("RR-C12SEAT", "m12-c", 11, 10), /at most 10/u);
  });

  await t.test("claimSeat: §4.3(a) seat invariants, including a freed middle seat", async () => {
    await store.createMember("m13-owner", "Zotëruesi");
    await store.createCircle("RR-C13FULL", "Dhjetë", "m13-owner");
    const keys = Array.from({ length: 10 }, (_, index) => `m13-${index}`);
    for (const key of keys) {
      await store.createMember(key, `Anëtar ${key}`);
      assert.equal(await store.claimSeat("RR-C13FULL", key, 10, 10), "created");
    }
    assert.equal((await store.listMembers("RR-C13FULL")).length, 10);

    // An eleventh is refused and the roster does not move.
    await store.createMember("m13-extra", "I njëmbëdhjeti");
    assert.equal(await store.claimSeat("RR-C13FULL", "m13-extra", 10, 10), "full");
    assert.equal((await store.listMembers("RR-C13FULL")).length, 10);

    // Free seat 4 — a middle seat, not the highest. This is the case that
    // MAX(seat)+1 gets wrong: it would compute seat 11 and violate
    // CHECK (seat BETWEEN 1 AND 10), leaving a once-full circle permanently
    // unjoinable. Lowest-free-seat is why this passes (deviation D7).
    await store.removeMembership("RR-C13FULL", keys[3]);
    assert.equal((await store.listMembers("RR-C13FULL")).length, 9);
    assert.equal(await store.claimSeat("RR-C13FULL", "m13-extra", 10, 10), "created");

    const roster = await store.listMembers("RR-C13FULL");
    assert.equal(roster.length, 10);
    assert.equal(new Set(roster.map((row) => row.memberKey)).size, 10);
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

// ---------------------------------------------------------------------------
// The database-level guarantees (PLAN-RRETHI-M1-API.md §10, lines 30, 31, 35).
//
// These need a real Postgres. `npm run test:neon-bridge` supplies one (WASM
// pglite) and so does RRETHI_TEST_NEON_URL pointed at a scratch project; on a
// plain `npm test` they report as skipped rather than passing vacuously.
// ---------------------------------------------------------------------------

/** The bridge serialises statements, so it cannot prove an interleaving. */
const IS_PGLITE_BRIDGE = NEON_URL.includes("bridge.invalid");
const NO_POSTGRES =
  NEON_URL === ""
    ? "needs a Postgres: run `npm run test:neon-bridge`, or set RRETHI_TEST_NEON_URL to a SCRATCH project"
    : false;

/** Applies arbitrary schema text into a throwaway schema and returns a handle. */
async function withSchema(sqlText, name) {
  const env = { NEON_DATABASE_URL: NEON_URL, RRETHI_PG_SCHEMA: name };
  const { rewriteSchemaStatements, dropNeonSchema } = await import("../api/_lib/store-neon.js");
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(NEON_URL);
  await sql.query(`CREATE SCHEMA IF NOT EXISTS "${name}"`);
  for (const statement of rewriteSchemaStatements(sqlText, name)) {
    await sql.query(statement);
  }
  return { env, sql, name, destroy: () => dropNeonSchema(env) };
}

async function readSchemaText() {
  return readFile(new URL("../api/_lib/schema.sql", import.meta.url), "utf8");
}

test("31. the seat constraints are enforced by the database, not the handler", { skip: NO_POSTGRES }, async () => {
  // Without these two assertions, a green suite would only show that the
  // adapter behaves — not that the database would refuse an eleventh seat if
  // the adapter ever stopped asking.
  const handle = await withSchema(await readSchemaText(), `rrethi_seat_${randomBytes(5).toString("hex")}`);
  const t = (table) => `"${handle.name}".${table}`;
  try {
    await handle.sql.query(`INSERT INTO ${t("member")} (member_key, display_name) VALUES ('k1', 'Ana')`);
    await handle.sql.query(
      `INSERT INTO ${t("circle")} (code, name, owner_key) VALUES ('C1', 'Familja', 'k1')`,
    );
    await handle.sql.query(
      `INSERT INTO ${t("membership")} (circle_code, member_key, seat) VALUES ('C1', 'k1', 1)`,
    );

    // A duplicate (circle_code, seat) — the collision two concurrent joins hit.
    await handle.sql.query(`INSERT INTO ${t("member")} (member_key, display_name) VALUES ('k2', 'Ben')`);
    await assert.rejects(
      () =>
        handle.sql.query(
          `INSERT INTO ${t("membership")} (circle_code, member_key, seat) VALUES ('C1', 'k2', 1)`,
        ),
      (error) => {
        assert.equal(error.code, "23505");
        return true;
      },
    );

    // Seat 11, the second line of defence behind the unique index.
    await assert.rejects(
      () =>
        handle.sql.query(
          `INSERT INTO ${t("membership")} (circle_code, member_key, seat) VALUES ('C1', 'k2', 11)`,
        ),
      (error) => {
        assert.equal(error.code, "23514");
        return true;
      },
    );
  } finally {
    await handle.destroy();
  }
});

test("30. concurrent claimSeat calls on a nine-seat circle grant exactly one", { skip: NO_POSTGRES }, async (t) => {
  if (IS_PGLITE_BRIDGE) {
    // Stated rather than hidden: under the bridge this asserts the invariants
    // hold, but it proves nothing about interleaving, because the bridge runs
    // statements one at a time. Only a run against a real Neon project makes
    // this a concurrency proof — which is what test 31 above exists to backstop.
    t.diagnostic("pglite bridge: statements are serialised, so this is an invariant check, not a race test");
  }
  const { applyNeonSchema, dropNeonSchema } = await import("../api/_lib/store-neon.js");
  const name = `rrethi_race_${randomBytes(5).toString("hex")}`;
  const env = { RRETHI_STORE: "neon", NEON_DATABASE_URL: NEON_URL, RRETHI_PG_SCHEMA: name };
  await applyNeonSchema(env);
  const store = await createStore(env);
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(NEON_URL);

  try {
    // A single run of a race test proves nothing about a race.
    const ROUNDS = 20;
    for (let round = 0; round < ROUNDS; round += 1) {
      const code = `RACE${round}`;
      const owner = `race-${round}-owner`;
      await store.createMember(owner, "Zotëruesi");
      await store.createCircle(code, "Familja", owner);
      // Seat the circle to nine.
      for (let index = 0; index < 9; index += 1) {
        const key = `race-${round}-${index}`;
        await store.createMember(key, `Anëtar ${index}`);
        assert.equal(await store.claimSeat(code, key, 10, 10), "created");
      }

      const keyA = `race-${round}-a`;
      const keyB = `race-${round}-b`;
      await store.createMember(keyA, "A");
      await store.createMember(keyB, "B");
      const [a, b] = await Promise.all([
        store.claimSeat(code, keyA, 10, 10),
        store.claimSeat(code, keyB, 10, 10),
      ]);

      const outcomes = [a, b].sort();
      assert.deepEqual(outcomes, ["created", "full"], `round ${round} produced ${outcomes}`);

      const counted = await sql.query(
        `SELECT count(*)::int AS total, count(DISTINCT seat)::int AS seats
           FROM "${name}".membership WHERE circle_code = $1`,
        [code],
      );
      const row = Array.isArray(counted) ? counted[0] : counted.rows[0];
      assert.equal(Number(row.total), 10, `round ${round}: roster is not 10`);
      assert.equal(Number(row.seats), Number(row.total), `round ${round}: two members share a seat`);
    }
  } finally {
    await dropNeonSchema(env);
  }
});

test("35. a fresh database and an upgraded M0 database end in the same shape", { skip: NO_POSTGRES }, async () => {
  const full = await readSchemaText();

  // The M0 text, derived from the shipped file by removing exactly what M1
  // added. Each removal is asserted to have changed something, so restructuring
  // schema.sql fails this loudly instead of silently testing nothing.
  let m0 = full;
  const strip = (pattern, label) => {
    const next = m0.replace(pattern, "");
    assert.notEqual(next, m0, `could not derive the M0 schema: ${label} not found`);
    m0 = next;
  };
  strip(/\n-- M1 deltas \(PLAN-RRETHI-M1-API\.md §6\)\.[\s\S]*$/u, "the M1 delta block");
  strip(/\n {2}avatar_id {4}TEXT NOT NULL DEFAULT '[^']*',/u, "member.avatar_id");
  strip(/\n {2}letter_seal {2}TEXT NOT NULL DEFAULT '[^']*',/u, "member.letter_seal");
  strip(/\n {2}seat {8}SMALLINT NOT NULL CONSTRAINT membership_seat_range CHECK \([^)]*\),/u, "membership.seat");
  // Asserted on the statements, not the raw text: the surrounding comments
  // legitimately still discuss seats, and the loader strips comments anyway.
  assert.ok(
    !m0.replace(/--[^\n]*/gu, "").includes("seat"),
    "the derived M0 schema still declares a seat column",
  );

  const suffix = randomBytes(5).toString("hex");
  const upgraded = await withSchema(m0, `rrethi_m0_${suffix}`);
  const fresh = await withSchema(full, `rrethi_new_${suffix}`);
  try {
    // Seed a row first, so the backfill and SET NOT NULL run against real data
    // rather than against an empty table.
    await upgraded.sql.query(
      `INSERT INTO "${upgraded.name}".member (member_key, display_name) VALUES ('k1', 'Ana')`,
    );
    await upgraded.sql.query(
      `INSERT INTO "${upgraded.name}".circle (code, name, owner_key) VALUES ('C1', 'Familja', 'k1')`,
    );
    await upgraded.sql.query(
      `INSERT INTO "${upgraded.name}".membership (circle_code, member_key) VALUES ('C1', 'k1')`,
    );

    const { rewriteSchemaStatements } = await import("../api/_lib/store-neon.js");
    // The upgrade path: apply the M1 file over the M0 database.
    for (const statement of rewriteSchemaStatements(full, upgraded.name)) {
      await upgraded.sql.query(statement);
    }
    // The fresh path: apply the M1 file a second time (re-running is a no-op).
    for (const statement of rewriteSchemaStatements(full, fresh.name)) {
      await fresh.sql.query(statement);
    }

    // The backfilled row kept its data and gained a valid seat and profile.
    const seeded = await upgraded.sql.query(
      `SELECT m.seat, p.avatar_id, p.letter_seal
         FROM "${upgraded.name}".membership m
         JOIN "${upgraded.name}".member p ON p.member_key = m.member_key`,
    );
    const seededRow = Array.isArray(seeded) ? seeded[0] : seeded.rows[0];
    assert.equal(Number(seededRow.seat), 1);
    assert.equal(seededRow.avatar_id, "stick-racer");
    assert.equal(seededRow.letter_seal, "ë");

    const shapeOf = async (handle) => {
      const columns = await handle.sql.query(
        `SELECT table_name, column_name, data_type, is_nullable, column_default
           FROM information_schema.columns WHERE table_schema = $1
          ORDER BY table_name, column_name`,
        [handle.name],
      );
      const indexes = await handle.sql.query(
        `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1 ORDER BY indexname`,
        [handle.name],
      );
      const constraints = await handle.sql.query(
        `SELECT conname, pg_get_constraintdef(oid) AS def
           FROM pg_constraint WHERE connamespace = $1::regnamespace ORDER BY conname, def`,
        [handle.name],
      );
      const rows = (output) => (Array.isArray(output) ? output : output.rows);
      // The schema name is in every indexdef and constraint def, so it is
      // normalised away before the two shapes are compared.
      return JSON.stringify({
        columns: rows(columns),
        indexes: rows(indexes),
        constraints: rows(constraints),
      }).replaceAll(handle.name, "SCHEMA");
    };

    assert.equal(await shapeOf(upgraded), await shapeOf(fresh));
    // And the shape actually contains what M1 added.
    const shape = await shapeOf(fresh);
    assert.match(shape, /membership_circle_seat_idx/u);
    assert.match(shape, /membership_seat_range/u);
    assert.match(shape, /"column_name":"avatar_id"/u);
    // Exactly one seat CHECK, not one per application of the file — the reason
    // the DROP IF EXISTS precedes the ADD and the CREATE TABLE names it too.
    assert.equal(shape.split("membership_seat_range").length - 1, 1);
  } finally {
    await upgraded.destroy();
    await fresh.destroy();
  }
});

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
  // 5 tables + 5 indexes (M1 added membership_circle_seat_idx) + the 7 M1
  // deltas of PLAN-RRETHI-M1-API.md §6.
  assert.equal(statements.length, 17);

  // Re-running the file must stay a no-op. Before M1 every statement said
  // IF NOT EXISTS and the substring was the whole check; the §6 deltas need
  // forms Postgres has no IF NOT EXISTS for, so each is matched against the
  // idempotent shape it actually relies on instead. A statement that fits none
  // of these is not safe to run on every deploy.
  const IDEMPOTENT_FORMS = [
    /^CREATE (?:TABLE|UNIQUE INDEX|INDEX) IF NOT EXISTS/u,
    /^ALTER TABLE .* ADD COLUMN IF NOT EXISTS/su,
    /^ALTER TABLE .* DROP CONSTRAINT IF EXISTS/su,
    // Re-adding is safe only because the DROP IF EXISTS above always precedes
    // it, which the ordering assertion below pins.
    /^ALTER TABLE .* ADD CONSTRAINT membership_seat_range CHECK/su,
    // Naturally repeatable: setting a NOT NULL that already holds, and a
    // backfill whose WHERE clause matches nothing on a second run.
    /^ALTER TABLE .* ALTER COLUMN seat SET NOT NULL$/su,
    /^UPDATE .* AND m\.seat IS NULL$/su,
  ];
  for (const statement of statements) {
    assert.doesNotMatch(statement, /public\./u);
    assert.ok(
      IDEMPOTENT_FORMS.some((form) => form.test(statement)),
      `statement is not idempotent by construction: ${statement.slice(0, 80)}`,
    );
  }
  assert.ok(
    statements.findIndex((s) => /DROP CONSTRAINT IF EXISTS membership_seat_range/u.test(s)) <
      statements.findIndex((s) => /ADD CONSTRAINT membership_seat_range/u.test(s)),
    "the seat CHECK must be dropped before it is re-added, or a second run fails",
  );
  assert.equal(
    statements.filter((statement) => statement.includes(`"rrethi_test_probe".`)).length,
    17,
  );

  // The column DEFAULTs are the client catalog's values. Re-typed literals here
  // and in src/avatars.js would drift silently, so store.js imports them and
  // this asserts schema.sql still spells the same two.
  const { DEFAULT_PROFILE } = await import("../api/_lib/store.js");
  assert.match(sqlText, new RegExp(`avatar_id\\s+TEXT NOT NULL DEFAULT '${DEFAULT_PROFILE.avatarId}'`, "u"));
  assert.match(sqlText, new RegExp(`letter_seal\\s+TEXT NOT NULL DEFAULT '${DEFAULT_PROFILE.letterSeal}'`, "u"));
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
