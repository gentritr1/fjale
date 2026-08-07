// The Rrethi spoiler guarantee, as executable assertions — plan §2.4 and the
// §2.12 M1 acceptance scenario ("B fetches the board before finishing and must
// see only that A is done — never A's score").
//
// These tests run against the pure board module, so they hold before any HTTP
// handler exists and stay the referee once one does: an M1 endpoint that
// bypasses buildBoard has no way to pass them.

import assert from "node:assert/strict";
import test from "node:test";

import { buildBoard, isBoardMasked } from "../api/_lib/board.js";
import { getTiranaDateKey } from "../src/game.js";
import { weeklyPoints } from "../src/points.js";

// A fixed instant whose Tirana calendar date anchors every scenario. 10:00 UTC
// is safely mid-day in Tirana (CET/CEST), far from either midnight.
const NOW = new Date("2026-08-05T10:00:00Z");
const TODAY = getTiranaDateKey(NOW);
const YESTERDAY = "2026-08-04";

const MEMBERS = [
  { memberKey: "hmac-a", displayName: "Alba" },
  { memberKey: "hmac-b", displayName: "Besnik" },
  { memberKey: "hmac-c", displayName: "Çiljeta" },
];

function result(memberKey, playDate, attempts, extra = {}) {
  return {
    circleCode: "RR-TEST",
    memberKey,
    playDate,
    attempts,
    besa: false,
    hint: false,
    seconds: null,
    createdAt: "2026-08-05T08:00:00.000Z",
    ...extra,
  };
}

test("the M1 acceptance scenario: B sees only that A finished, never how well", () => {
  // A finished today with a strong result; B has not played yet.
  const board = buildBoard({
    members: MEMBERS,
    results: [result("hmac-a", TODAY, 2, { besa: true })],
    viewerKey: "hmac-b",
    playDate: TODAY,
    now: NOW,
  });

  assert.equal(board.masked, true);

  const alba = board.rows.find((row) => row.displayName === "Alba");
  assert.equal(alba.finished, true);

  // §2.4's first testable consequence: the numeric keys are ABSENT, not null
  // and not zero. Serialize and inspect the wire shape, because that is what a
  // devtools reader actually sees.
  const wire = JSON.parse(JSON.stringify(board));
  for (const row of wire.rows) {
    assert.deepEqual(
      Object.keys(row).sort(),
      row.you ? ["displayName", "finished", "you"] : ["displayName", "finished"],
      "a masked row carries exactly displayName/finished (+you)",
    );
  }
  assert.doesNotMatch(
    JSON.stringify(board),
    /attempts|besa|hint|points|streak|seconds|memberKey|hmac-/u,
    "nothing in the masked payload names a score field or a member key",
  );

  // A masked board keeps roster order: sorting by result would leak the
  // ranking through position.
  assert.deepEqual(
    wire.rows.map((row) => row.displayName),
    ["Alba", "Besnik", "Çiljeta"],
  );
});

test("the same request after B submits reveals the full board", () => {
  const results = [
    result("hmac-a", TODAY, 2, { besa: true }),
    result("hmac-b", TODAY, 4),
  ];
  const board = buildBoard({
    members: MEMBERS,
    results,
    viewerKey: "hmac-b",
    playDate: TODAY,
    now: NOW,
  });

  assert.equal(board.masked, false);
  const alba = board.rows.find((row) => row.displayName === "Alba");
  assert.equal(alba.attempts, 2);
  assert.equal(alba.besa, true);
  assert.equal(alba.points, weeklyPoints(results[0]));
  const besnik = board.rows.find((row) => row.you);
  assert.equal(besnik.displayName, "Besnik");
  assert.equal(besnik.attempts, 4);
  // Best result first on a revealed board; unfinished members last.
  assert.deepEqual(
    board.rows.map((row) => row.displayName),
    ["Alba", "Besnik", "Çiljeta"],
  );
  assert.equal(board.rows.at(-1).finished, false);
});

test("yesterday stays masked for a viewer who has not played it — the archive keeps it spoilable", () => {
  // Amends §2.4's "yesterday is always visible": yesterday's word is one tap
  // away in the archive and still inside §2.5's write window, so it is treated
  // exactly like today — masked until the viewer's own result exists.
  const board = buildBoard({
    members: MEMBERS,
    results: [result("hmac-a", YESTERDAY, 6)],
    viewerKey: "hmac-b",
    playDate: YESTERDAY,
    now: NOW,
  });

  assert.equal(board.masked, true);
  for (const row of JSON.parse(JSON.stringify(board)).rows) {
    assert.deepEqual(
      Object.keys(row).sort(),
      row.you ? ["displayName", "finished", "you"] : ["displayName", "finished"],
    );
  }
});

test("yesterday reveals to a viewer who finished it, and older days reveal to everyone", () => {
  // Finishing yesterday (daily or archive replay, both inside the write
  // window) unmasks it for that viewer...
  const finished = buildBoard({
    members: MEMBERS,
    results: [result("hmac-a", YESTERDAY, 6), result("hmac-b", YESTERDAY, 3)],
    viewerKey: "hmac-b",
    playDate: YESTERDAY,
    now: NOW,
  });
  assert.equal(finished.masked, false);
  assert.equal(finished.rows.find((row) => row.displayName === "Alba").attempts, 6);

  // ...and two days back is outside the write window: no result can ever be
  // posted for it, so masking would be permanent — it reveals unconditionally.
  const twoDaysAgo = buildBoard({
    members: MEMBERS,
    results: [result("hmac-a", "2026-08-03", 5)],
    viewerKey: "hmac-b",
    playDate: "2026-08-03",
    now: NOW,
  });
  assert.equal(twoDaysAgo.masked, false);
  assert.equal(twoDaysAgo.rows.find((row) => row.displayName === "Alba").attempts, 5);
});

test("a loss is spelled X on the wire, never null and never 0", () => {
  const board = buildBoard({
    members: MEMBERS,
    results: [
      result("hmac-a", YESTERDAY, null),
      result("hmac-b", YESTERDAY, 3),
    ],
    viewerKey: "hmac-b",
    playDate: YESTERDAY,
    now: NOW,
  });

  const alba = board.rows.find((row) => row.displayName === "Alba");
  assert.equal(alba.attempts, "X");
  assert.equal(alba.points, 0);
  // Losses sort after wins, before the unfinished.
  assert.deepEqual(
    board.rows.map((row) => row.displayName),
    ["Besnik", "Alba", "Çiljeta"],
  );
});

test("seconds appear only when the circle opted into show_time", () => {
  const timed = result("hmac-a", YESTERDAY, 3, { seconds: 187 });

  const withoutOptIn = buildBoard({
    members: MEMBERS,
    results: [timed],
    viewerKey: "hmac-a",
    playDate: YESTERDAY,
    now: NOW,
  });
  assert.doesNotMatch(JSON.stringify(withoutOptIn), /seconds|187/u);

  const withOptIn = buildBoard({
    members: MEMBERS,
    results: [timed],
    viewerKey: "hmac-a",
    playDate: YESTERDAY,
    showTime: true,
    now: NOW,
  });
  assert.equal(
    withOptIn.rows.find((row) => row.displayName === "Alba").seconds,
    187,
  );
});

test("member keys never reach the payload, in any state", () => {
  for (const viewerKey of ["hmac-a", "hmac-b"]) {
    for (const playDate of [TODAY, YESTERDAY]) {
      const board = buildBoard({
        members: MEMBERS,
        results: [result("hmac-a", playDate, 1)],
        viewerKey,
        playDate,
        streaks: { "hmac-a": 12 },
        now: NOW,
      });
      assert.doesNotMatch(JSON.stringify(board), /hmac-|memberKey/u);
    }
  }
});

test("rows from another day are refused outright", () => {
  // A caller mixing days would publish one day's results under another date —
  // the exact leak this module exists to prevent — so it must throw, not
  // filter: filtering would hide the caller's bug.
  assert.throws(
    () =>
      buildBoard({
        members: MEMBERS,
        results: [result("hmac-a", YESTERDAY, 2)],
        viewerKey: "hmac-b",
        playDate: TODAY,
        now: NOW,
      }),
    /must all belong to playDate/u,
  );
});

test("isBoardMasked follows the Tirana day, not the server's UTC day", () => {
  // 22:30 UTC on Aug 5 is already Aug 6 in Tirana (CEST, UTC+2): Aug 6 is the
  // new today and Aug 5 has just become yesterday — both masked until played;
  // Aug 4 aged out of the write window at that same midnight and reveals.
  const lateEvening = new Date("2026-08-05T22:30:00Z");
  assert.equal(getTiranaDateKey(lateEvening), "2026-08-06");
  assert.equal(isBoardMasked("2026-08-06", false, lateEvening), true);
  assert.equal(isBoardMasked("2026-08-05", false, lateEvening), true);
  assert.equal(isBoardMasked("2026-08-04", false, lateEvening), false);
  // Finishing always unmasks, whatever the clock says.
  assert.equal(isBoardMasked("2026-08-06", true, lateEvening), false);
});

test("the guard fails closed on degenerate inputs instead of unmasking", () => {
  // `new Date(null)` is the epoch, not Invalid Date — an unvalidated clock
  // would resolve "today" to 1970-01-01 and silently unmask everything
  // (adversarial review, MAJOR 2). Both arming inputs must throw instead.
  for (const badNow of [null, false, 0, "", "2026-08-05", NaN, new Date(NaN)]) {
    assert.throws(
      () =>
        buildBoard({
          members: MEMBERS,
          results: [],
          viewerKey: "hmac-b",
          playDate: TODAY,
          now: badNow,
        }),
      /now must be a valid Date/u,
      `now=${String(badNow)} must throw`,
    );
  }
  for (const badFinished of ["false", "0", [], {}, 1]) {
    assert.throws(
      () => isBoardMasked(TODAY, badFinished, NOW),
      /viewerFinished must be a boolean/u,
      `viewerFinished=${String(badFinished)} must throw`,
    );
  }
});

test("a viewer outside the roster is refused, not rendered", () => {
  assert.throws(
    () =>
      buildBoard({
        members: MEMBERS,
        results: [],
        viewerKey: "hmac-stranger",
        playDate: TODAY,
        now: NOW,
      }),
    /viewerKey must be a member/u,
  );
});

test("malformed stored attempts become a loss on the wire, never a fake win", () => {
  // Store validation and the schema CHECK both reject these, so this is
  // defense-in-depth: if a bad row ever exists, it must not sort above a real
  // win (attempts: 0 would) or contradict its own 0-point score.
  const board = buildBoard({
    members: MEMBERS,
    results: [
      result("hmac-a", "2026-08-03", 0),
      result("hmac-b", "2026-08-03", 3),
      result("hmac-c", "2026-08-03", 7.5),
    ],
    viewerKey: "hmac-b",
    playDate: "2026-08-03",
    now: NOW,
  });

  const alba = board.rows.find((row) => row.displayName === "Alba");
  const cil = board.rows.find((row) => row.displayName === "Çiljeta");
  assert.equal(alba.attempts, "X");
  assert.equal(alba.points, 0);
  assert.equal(cil.attempts, "X");
  // The real win leads; both malformed rows rank as losses behind it.
  assert.equal(board.rows[0].displayName, "Besnik");
});

test("privacy opt-ins are strict booleans and numbers, never truthy lookalikes", () => {
  const timed = result("hmac-a", "2026-08-03", 3, { seconds: 187 });
  for (const almostTrue of ["yes", 1, {}]) {
    const board = buildBoard({
      members: MEMBERS,
      results: [timed],
      viewerKey: "hmac-a",
      playDate: "2026-08-03",
      showTime: almostTrue,
      now: NOW,
    });
    assert.doesNotMatch(JSON.stringify(board), /seconds|187/u);
  }

  const oddStreaks = buildBoard({
    members: MEMBERS,
    results: [timed],
    viewerKey: "hmac-a",
    playDate: "2026-08-03",
    streaks: { "hmac-a": { pwned: true } },
    now: NOW,
  });
  assert.doesNotMatch(JSON.stringify(oddStreaks), /streak|pwned/u);
});
