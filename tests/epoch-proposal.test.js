import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { sha256 } from "../scripts/build-editorial-batch.mjs";
import {
  addCalendarDays,
  buildEpochProposal,
  createEpochProposal,
  currentDailyAnswerIds,
  getTiranaDateKeyForTimestamp,
  nextProposalVersion,
  proposalFilename,
  validateDecisionsDocument,
  validateTiranaDate,
} from "../scripts/build-epoch-proposal.mjs";
import { DAILY_EPOCHS } from "../src/game.js";
import { ANSWERS } from "../src/words.js";

const FIXED_TIME = "2026-07-20T12:00:00.000Z";
const BATCH_URL = new URL(
  "../editorial/batches/answers-2026-07-62-137-v1.json",
  import.meta.url,
);
const FIXTURE_URL = new URL("./fixtures/daily-schedule.json", import.meta.url);
const LAUNCH_EPOCHS = Object.freeze([DAILY_EPOCHS[0]]);

async function loadInputs() {
  const [batchDocument, fixture] = await Promise.all([
    readFile(BATCH_URL, "utf8").then(JSON.parse),
    readFile(FIXTURE_URL, "utf8").then(JSON.parse),
  ]);
  return { batchDocument, fixture };
}

function buildDecisions(
  batchDocument,
  outcomes = new Map(),
  reviewers = ["reviewer-1", "reviewer-2"],
) {
  const decisions = batchDocument.entries.map((source) => {
    const outcome = outcomes.get(source.answerId) ?? "reject_content";
    const reviewVerdicts = outcome === "conflict"
      ? reviewers.map((_, index) => (index === 0 ? "approve_daily" : "reject_content"))
      : reviewers.map(() => outcome);
    const decision = {
      answerId: source.answerId,
      sourceSha256: source.sourceSha256,
      outcome,
      reviews: reviewers.map((reviewerId, index) => ({
        reviewerId,
        verdict: reviewVerdicts[index],
        proposedEntrySha256:
          reviewVerdicts[index] === "reject_content" ? null : source.sourceSha256,
        reason: reviewVerdicts[index] === "approve_daily" ? "" : "Vendim prove.",
        notes: "",
        reviewedAt: FIXED_TIME,
      })),
    };
    if (outcome === "approve_daily") {
      decision.approvedEntrySha256 = sha256(source.entry);
      decision.approvedEntry = structuredClone(source.entry);
    }
    return decision;
  });
  const count = (outcome) => decisions.filter((decision) => decision.outcome === outcome).length;
  return {
    schemaVersion: 1,
    kind: "fjale-editorial-decisions",
    batch: structuredClone(batchDocument.batch),
    generatedAt: FIXED_TIME,
    reviewers,
    summary: {
      approved: count("approve_daily"),
      practiceOnly: count("practice_only"),
      rejected: count("reject_content"),
      needsRevision: count("needs_revision"),
      conflict: count("conflict"),
      incomplete: 0,
      total: decisions.length,
    },
    decisions,
  };
}

test("builds an immutable explicit-id proposal and a 90-day answer preview", async () => {
  const { batchDocument, fixture } = await loadInputs();
  const decisionsDocument = buildDecisions(
    batchDocument,
    new Map([
      [62, "approve_daily"],
      [63, "practice_only"],
      [64, "approve_daily"],
    ]),
  );
  const proposal = buildEpochProposal({
    start: "2026-07-23",
    decisionsDocument,
    batchDocument,
    fixture,
    generatedAt: FIXED_TIME,
    existingEpochs: LAUNCH_EPOCHS,
  });

  assert.equal(proposal.kind, "fjale-daily-epoch-proposal");
  assert.equal(proposal.proposal.id, "epoch-2026-07-23-answers-2026-07-62-137-v1-v1");
  assert.deepEqual(proposal.epoch.answerIds, [
    ...Array.from({ length: 62 }, (_, answerId) => answerId),
    62,
    64,
  ]);
  assert.equal(proposal.epoch.poolSize, 64);
  assert.equal(proposal.epoch.stepBase, DAILY_EPOCHS.at(-1).stepBase);
  assert.equal(proposal.epoch.offset, DAILY_EPOCHS.at(-1).offset);
  assert.ok(Object.isFrozen(proposal));
  assert.ok(Object.isFrozen(proposal.epoch));
  assert.ok(Object.isFrozen(proposal.epoch.answerIds));
  assert.deepEqual(proposal.approvedAnswerIds, [62, 64]);
  assert.deepEqual(proposal.excludedAnswerIds.practiceOnly, [63]);
  assert.ok(proposal.excludedAnswerIds.rejected.includes(65));
  assert.deepEqual(proposal.excludedAnswerIds.needsRevision, []);
  assert.deepEqual(proposal.excludedAnswerIds.conflict, []);

  assert.equal(proposal.preview.days, 90);
  assert.equal(proposal.preview.start, "2026-07-23");
  assert.equal(proposal.preview.end, "2026-10-20");
  assert.equal(Object.keys(proposal.preview.schedule).length, 90);
  const previewIds = new Set(
    Object.values(proposal.preview.schedule).map(({ answerId }) => answerId),
  );
  assert.ok(previewIds.has(62));
  assert.ok(previewIds.has(64));
  assert.ok(!previewIds.has(63));
  assert.ok(!previewIds.has(65));

  assert.deepEqual(
    {
      checkedDates: proposal.historyProof.checkedDates,
      first: proposal.historyProof.firstCheckedDate,
      last: proposal.historyProof.lastCheckedDate,
      unchanged: proposal.historyProof.unchanged,
    },
    { checkedDates: 7, first: "2026-07-16", last: "2026-07-22", unchanged: true },
  );
  assert.equal(
    proposal.historyProof.fixturePrefixSha256,
    proposal.historyProof.currentPrefixSha256,
  );
  assert.equal(
    proposal.historyProof.fixturePrefixSha256,
    proposal.historyProof.proposedPrefixSha256,
  );
});

test("accepts the latest frozen explicit answer-id pool instead of a legacy prefix", () => {
  const explicitIds = Object.freeze([0, 5, 61]);
  const epochs = Object.freeze([
    DAILY_EPOCHS[0],
    Object.freeze({
      start: "2026-08-01",
      answerIds: explicitIds,
      poolSize: explicitIds.length,
      stepBase: 37,
      offset: 911,
    }),
  ]);

  const resolved = currentDailyAnswerIds(epochs, ANSWERS);
  assert.deepEqual(resolved, explicitIds);
  assert.ok(Object.isFrozen(resolved));
});

test("accepts only the documented one-reviewer decisions exception", async () => {
  const { batchDocument } = await loadInputs();
  const outcomes = new Map(
    batchDocument.batch.answerIds.map((answerId) => [answerId, "approve_daily"]),
  );
  const approvedException = buildDecisions(batchDocument, outcomes, ["neki"]);

  assert.equal(validateDecisionsDocument(approvedException, batchDocument), approvedException);

  const unapprovedReviewer = buildDecisions(batchDocument, outcomes, ["other-reviewer"]);
  assert.throws(
    () => validateDecisionsDocument(unapprovedReviewer, batchDocument),
    /documented one-time exception/u,
  );
});

test("rejects unresolved revision and conflict outcomes and identifies their ids", async () => {
  const { batchDocument, fixture } = await loadInputs();
  const decisionsDocument = buildDecisions(
    batchDocument,
    new Map([
      [62, "needs_revision"],
      [63, "conflict"],
      [64, "approve_daily"],
    ]),
  );

  assert.throws(
    () =>
      buildEpochProposal({
        start: "2026-09-01",
        decisionsDocument,
        batchDocument,
        fixture,
        generatedAt: FIXED_TIME,
      }),
    /needs_revision=62; conflict=63/u,
  );
});

test("strictly validates Tirana dates, decisions, ids, hashes, and summaries", async () => {
  const { batchDocument } = await loadInputs();
  const decisionsDocument = buildDecisions(
    batchDocument,
    new Map([[62, "approve_daily"]]),
  );

  assert.equal(validateTiranaDate("2028-02-29"), "2028-02-29");
  assert.equal(getTiranaDateKeyForTimestamp("2026-07-19T22:30:00.000Z"), "2026-07-20");
  assert.equal(addCalendarDays("2026-10-24", 2), "2026-10-26");
  assert.throws(() => validateTiranaDate("2026-2-03"), /YYYY-MM-DD/u);
  assert.throws(() => validateTiranaDate("2026-02-30"), /real Tirana calendar/u);
  assert.throws(
    () => currentDailyAnswerIds([{ ...DAILY_EPOCHS[0], poolSize: ANSWERS.length + 1 }]),
    /does not exist in ANSWERS/u,
  );

  const staleBatch = structuredClone(batchDocument);
  staleBatch.batch.sourceCatalogSha256 = "0".repeat(64);
  assert.throws(
    () => validateDecisionsDocument(decisionsDocument, staleBatch),
    /source catalog hash is stale/u,
  );

  const missingApproval = structuredClone(decisionsDocument);
  delete missingApproval.decisions[0].approvedEntry;
  assert.throws(
    () => validateDecisionsDocument(missingApproval, batchDocument),
    /must contain exactly/u,
  );

  const badApprovalHash = structuredClone(decisionsDocument);
  badApprovalHash.decisions[0].approvedEntry.clue = "Ndryshim pa hash të ri.";
  assert.throws(
    () => validateDecisionsDocument(badApprovalHash, batchDocument),
    /stale approved-entry hash/u,
  );

  const wrongSummary = structuredClone(decisionsDocument);
  wrongSummary.summary.approved = 0;
  assert.throws(
    () => validateDecisionsDocument(wrongSummary, batchDocument),
    /summary.approved/u,
  );

  const incomplete = structuredClone(decisionsDocument);
  incomplete.summary.incomplete = 1;
  assert.throws(
    () => validateDecisionsDocument(incomplete, batchDocument),
    /fully reconciled/u,
  );
});

test("refuses a start at the latest epoch and detects any fixture-history drift", async () => {
  const { batchDocument, fixture } = await loadInputs();
  const decisionsDocument = buildDecisions(
    batchDocument,
    new Map([[62, "approve_daily"]]),
  );
  const options = {
    decisionsDocument,
    batchDocument,
    fixture,
    generatedAt: FIXED_TIME,
    existingEpochs: LAUNCH_EPOCHS,
  };

  assert.throws(
    () => buildEpochProposal({ ...options, start: LAUNCH_EPOCHS.at(-1).start }),
    /must be after the latest epoch start/u,
  );
  assert.throws(
    () => buildEpochProposal({ ...options, start: "2026-07-20" }),
    /must be after the published Tirana date 2026-07-20/u,
  );
  const shortFixture = Object.fromEntries(
    Object.entries(fixture).filter(([date]) => date < "2026-07-20"),
  );
  assert.throws(
    () => buildEpochProposal({ ...options, start: "2026-09-01", fixture: shortFixture }),
    /must cover the published Tirana date 2026-07-20/u,
  );
  const driftedFixture = structuredClone(fixture);
  driftedFixture["2026-07-16"] = "fjalë";
  assert.throws(
    () =>
      buildEpochProposal({
        ...options,
        start: "2026-09-01",
        fixture: driftedFixture,
      }),
    /already differs from the fixture on 2026-07-16/u,
  );
});

test("numbers proposal files monotonically and writes versioned JSON end to end", async () => {
  const { batchDocument, fixture } = await loadInputs();
  const decisionsDocument = buildDecisions(
    batchDocument,
    new Map(
      batchDocument.batch.answerIds.map((answerId) => [answerId, "approve_daily"]),
    ),
  );
  const directory = await mkdtemp(resolve(tmpdir(), "fjale-epoch-proposal-"));
  const batchesDir = resolve(directory, "batches");
  const proposalsDir = resolve(directory, "proposals");
  const decisionsPath = resolve(directory, "decisions.json");
  const fixturePath = resolve(directory, "daily-schedule.json");
  await mkdir(batchesDir, { recursive: true });
  await Promise.all([
    writeFile(
      resolve(batchesDir, `${batchDocument.batch.id}.json`),
      JSON.stringify(batchDocument),
    ),
    writeFile(decisionsPath, JSON.stringify(decisionsDocument)),
    writeFile(fixturePath, JSON.stringify(fixture)),
  ]);

  assert.equal(
    nextProposalVersion(
      [
        "epoch-2026-09-01-answers-2026-07-62-137-v1-v1.json",
        "epoch-2026-09-01-answers-2026-07-62-137-v1-v3.json",
        "unrelated.json",
      ],
      "2026-09-01",
      batchDocument.batch.id,
    ),
    4,
  );
  assert.equal(
    proposalFilename("2026-09-01", batchDocument.batch.id, 4),
    "epoch-2026-09-01-answers-2026-07-62-137-v1-v4.json",
  );

  const first = await createEpochProposal({
    start: "2026-09-01",
    decisionsPath,
    batchesDir,
    fixturePath,
    proposalsDir,
    generatedAt: FIXED_TIME,
  });
  const second = await createEpochProposal({
    start: "2026-09-01",
    decisionsPath,
    batchesDir,
    fixturePath,
    proposalsDir,
    generatedAt: FIXED_TIME,
  });
  assert.match(first.pathname, /-v1\.json$/u);
  assert.match(second.pathname, /-v2\.json$/u);
  assert.equal(first.proposal.proposal.version, 1);
  assert.equal(second.proposal.proposal.version, 2);
  assert.deepEqual(JSON.parse(await readFile(first.pathname, "utf8")), first.proposal);
});
