import {
  link,
  mkdir,
  readFile,
  readdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DAILY_EPOCHS, getDailyAnswerIndex } from "../src/game.js";
import { ANSWERS } from "../src/words.js";
import { canonicalJson, sha256 } from "./build-editorial-batch.mjs";
import {
  DEFAULT_EDITORIAL_DECISIONS_PATH,
  isSingleReviewerException,
} from "./reconcile-editorial-reviews.mjs";

export const EPOCH_PROPOSAL_SCHEMA_VERSION = 1;
export const EPOCH_PROPOSAL_KIND = "fjale-daily-epoch-proposal";
export const EPOCH_PREVIEW_DAYS = 90;

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_EPOCH_PROPOSALS_DIR = resolve(
  REPOSITORY_ROOT,
  "editorial",
  "epoch-proposals",
);
export const DEFAULT_EDITORIAL_BATCHES_DIR = resolve(REPOSITORY_ROOT, "editorial", "batches");
export const DEFAULT_DAILY_FIXTURE_PATH = resolve(
  REPOSITORY_ROOT,
  "tests",
  "fixtures",
  "daily-schedule.json",
);

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const BATCH_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,99}$/u;
const TIRANA_TIME_ZONE = "Europe/Tirane";
const DECISION_OUTCOMES = Object.freeze([
  "approve_daily",
  "practice_only",
  "reject_content",
  "needs_revision",
  "conflict",
]);
const SUMMARY_KEYS_BY_OUTCOME = Object.freeze({
  approve_daily: "approved",
  practice_only: "practiceOnly",
  reject_content: "rejected",
  needs_revision: "needsRevision",
  conflict: "conflict",
});

function assertPlainObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
}

function assertExactKeys(value, keys, label) {
  assertPlainObject(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error(`${label} must contain exactly: ${expected.join(", ")}.`);
  }
}

function assertSha256(value, label) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest.`);
  }
}

function assertIsoTimestamp(value, label) {
  if (
    typeof value !== "string" ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new Error(`${label} must be an ISO UTC timestamp.`);
  }
}

export function validateTiranaDate(value, label = "start") {
  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) {
    throw new Error(`${label} must use the YYYY-MM-DD Tirana date format.`);
  }

  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() + 1 !== month ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(`${label} must be a real Tirana calendar date.`);
  }

  return value;
}

function dateAtTiranaMidday(dateKey) {
  validateTiranaDate(dateKey, "date");
  return new Date(`${dateKey}T12:00:00Z`);
}

export function addCalendarDays(dateKey, amount) {
  validateTiranaDate(dateKey, "date");
  if (!Number.isSafeInteger(amount)) {
    throw new TypeError("amount must be a safe integer number of calendar days.");
  }
  const [year, month, day] = dateKey.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + amount));
  return [
    String(next.getUTCFullYear()).padStart(4, "0"),
    String(next.getUTCMonth() + 1).padStart(2, "0"),
    String(next.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

export function getTiranaDateKeyForTimestamp(timestamp) {
  assertIsoTimestamp(timestamp, "timestamp");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIRANA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function answersById(answers) {
  if (!Array.isArray(answers) || answers.length === 0) {
    throw new Error("answers must be a nonempty array.");
  }

  const result = new Map();
  for (const answer of answers) {
    assertPlainObject(answer, "answer");
    if (!Number.isSafeInteger(answer.id) || answer.id < 0) {
      throw new Error("Every catalog answer must have a non-negative safe integer id.");
    }
    if (result.has(answer.id)) {
      throw new Error(`Duplicate catalog answer id ${answer.id}.`);
    }
    if (typeof answer.word !== "string" || answer.word.trim() === "") {
      throw new Error(`Catalog answer ${answer.id} must have a word.`);
    }
    result.set(answer.id, answer);
  }
  return result;
}

function validateAnswerIds(answerIds, catalog, label, { allowEmpty = false } = {}) {
  if (!Array.isArray(answerIds) || (!allowEmpty && answerIds.length === 0)) {
    throw new Error(`${label} must be ${allowEmpty ? "an" : "a nonempty"} array.`);
  }

  const seen = new Set();
  for (const answerId of answerIds) {
    if (!Number.isSafeInteger(answerId) || answerId < 0) {
      throw new Error(`${label} must contain non-negative safe integer ids.`);
    }
    if (seen.has(answerId)) {
      throw new Error(`${label} contains duplicate answer id ${answerId}.`);
    }
    if (!catalog.has(answerId)) {
      throw new Error(`${label} contains answer id ${answerId}, which does not exist in ANSWERS.`);
    }
    seen.add(answerId);
  }
  return answerIds;
}

function validateBatchDocument(batchDocument, catalog) {
  assertExactKeys(
    batchDocument,
    ["schemaVersion", "kind", "batch", "entries"],
    "batch document",
  );
  if (batchDocument.schemaVersion !== 1 || batchDocument.kind !== "fjale-editorial-batch") {
    throw new Error("Unsupported editorial batch document.");
  }
  assertExactKeys(
    batchDocument.batch,
    ["id", "sourceCatalogSha256", "answerIds"],
    "batch document.batch",
  );
  if (
    typeof batchDocument.batch.id !== "string" ||
    !BATCH_ID_PATTERN.test(batchDocument.batch.id)
  ) {
    throw new Error("batch document.batch.id is not a safe versioned batch id.");
  }
  assertSha256(
    batchDocument.batch.sourceCatalogSha256,
    "batch document.batch.sourceCatalogSha256",
  );
  validateAnswerIds(batchDocument.batch.answerIds, catalog, "batch answerIds");
  if (
    !Array.isArray(batchDocument.entries) ||
    batchDocument.entries.length !== batchDocument.batch.answerIds.length
  ) {
    throw new Error("Batch entries must cover every batch answer id exactly once.");
  }

  batchDocument.entries.forEach((source, index) => {
    assertExactKeys(source, ["answerId", "sourceSha256", "entry"], `batch entries[${index}]`);
    if (source.answerId !== batchDocument.batch.answerIds[index]) {
      throw new Error("Batch entries and batch answerIds must use the same order.");
    }
    assertSha256(source.sourceSha256, `batch entries[${index}].sourceSha256`);
    assertPlainObject(source.entry, `batch entries[${index}].entry`);
    if (source.entry.id !== source.answerId) {
      throw new Error(`Batch entry ${source.answerId} must retain its immutable id.`);
    }
    if (source.entry.word !== catalog.get(source.answerId).word) {
      throw new Error(`Batch entry ${source.answerId} must retain its immutable word identity.`);
    }
    if (sha256(source.entry) !== source.sourceSha256) {
      throw new Error(`Batch entry ${source.answerId} has a stale source hash.`);
    }
  });
  if (sha256(batchDocument.entries) !== batchDocument.batch.sourceCatalogSha256) {
    throw new Error("Batch source catalog hash is stale.");
  }
}

function validateReviewCoverage(decision, reviewers, label) {
  if (!Array.isArray(decision.reviews) || decision.reviews.length !== reviewers.length) {
    throw new Error(`${label}.reviews must contain every reconciled reviewer.`);
  }
  const covered = decision.reviews.map((review, index) => {
    const reviewLabel = `${label}.reviews[${index}]`;
    assertExactKeys(
      review,
      [
        "reviewerId",
        "verdict",
        "proposedEntrySha256",
        "reason",
        "notes",
        "reviewedAt",
      ],
      reviewLabel,
    );
    if (typeof review.reviewerId !== "string") {
      throw new Error(`${reviewLabel}.reviewerId must be a string.`);
    }
    if (!["approve_daily", "practice_only", "reject_content", "needs_revision"].includes(review.verdict)) {
      throw new Error(`${reviewLabel}.verdict is not supported.`);
    }
    if (review.proposedEntrySha256 !== null) {
      assertSha256(review.proposedEntrySha256, `${reviewLabel}.proposedEntrySha256`);
    }
    if (typeof review.reason !== "string" || typeof review.notes !== "string") {
      throw new Error(`${reviewLabel}.reason and notes must be strings.`);
    }
    assertIsoTimestamp(review.reviewedAt, `${reviewLabel}.reviewedAt`);
    return review.reviewerId;
  });
  if (new Set(covered).size !== covered.length || canonicalJson([...covered].sort()) !== canonicalJson(reviewers)) {
    throw new Error(`${label}.reviews must cover the reconciled reviewers exactly once.`);
  }
}

function validateReconciledOutcome(decision, label) {
  const verdicts = new Set(decision.reviews.map(({ verdict }) => verdict));
  const proposedDigests = new Set(
    decision.reviews.map(({ proposedEntrySha256 }) => proposedEntrySha256),
  );

  if (decision.outcome === "conflict") {
    const unanimousVerdict = verdicts.size === 1 ? [...verdicts][0] : null;
    const isMetadataConflict =
      (unanimousVerdict === "approve_daily" || unanimousVerdict === "practice_only") &&
      (proposedDigests.size !== 1 || proposedDigests.has(null));
    if (verdicts.size === 1 && !isMetadataConflict) {
      throw new Error(`${label}.outcome conflict is not supported by its reviewer decisions.`);
    }
    return;
  }

  if (
    verdicts.size !== 1 ||
    !verdicts.has(decision.outcome)
  ) {
    throw new Error(`${label}.outcome does not match its unanimous reviewer decisions.`);
  }
  if (
    (decision.outcome === "approve_daily" || decision.outcome === "practice_only") &&
    (proposedDigests.size !== 1 || proposedDigests.has(null))
  ) {
    throw new Error(`${label}.outcome requires matching non-null proposed-entry hashes.`);
  }
  if (
    decision.outcome === "approve_daily" &&
    !proposedDigests.has(decision.approvedEntrySha256)
  ) {
    throw new Error(`${label}.approvedEntrySha256 does not match its reviewer decisions.`);
  }
}

export function validateDecisionsDocument(
  decisionsDocument,
  batchDocument,
  answers = ANSWERS,
) {
  const catalog = answersById(answers);
  validateBatchDocument(batchDocument, catalog);
  assertExactKeys(
    decisionsDocument,
    ["schemaVersion", "kind", "batch", "generatedAt", "reviewers", "summary", "decisions"],
    "decisions document",
  );
  if (
    decisionsDocument.schemaVersion !== 1 ||
    decisionsDocument.kind !== "fjale-editorial-decisions"
  ) {
    throw new Error("Unsupported editorial decisions document.");
  }
  assertIsoTimestamp(decisionsDocument.generatedAt, "decisions document.generatedAt");
  if (
    canonicalJson(decisionsDocument.batch) !== canonicalJson(batchDocument.batch)
  ) {
    throw new Error("Decisions batch reference does not match the frozen editorial batch.");
  }
  const reviewersUseApprovedException = isSingleReviewerException(
    decisionsDocument.batch,
    decisionsDocument.reviewers,
  );
  if (
    !Array.isArray(decisionsDocument.reviewers) ||
    (decisionsDocument.reviewers.length < 2 && !reviewersUseApprovedException) ||
    decisionsDocument.reviewers.some(
      (reviewer) => typeof reviewer !== "string" || reviewer.trim() === "",
    ) ||
    new Set(decisionsDocument.reviewers).size !== decisionsDocument.reviewers.length
  ) {
    throw new Error(
      "A reconciled document requires at least two unique reviewers unless it matches the documented one-time exception.",
    );
  }
  const reviewers = [...decisionsDocument.reviewers].sort();
  if (canonicalJson(reviewers) !== canonicalJson(decisionsDocument.reviewers)) {
    throw new Error("Decisions reviewers must be stored in stable sorted order.");
  }
  if (
    !Array.isArray(decisionsDocument.decisions) ||
    decisionsDocument.decisions.length !== batchDocument.batch.answerIds.length
  ) {
    throw new Error("Decisions must cover every batch answer id exactly once.");
  }

  const sourceById = new Map(
    batchDocument.entries.map((source) => [source.answerId, source]),
  );
  const outcomeCounts = Object.fromEntries(DECISION_OUTCOMES.map((outcome) => [outcome, 0]));
  decisionsDocument.decisions.forEach((decision, index) => {
    assertPlainObject(decision, `decisions[${index}]`);
    const approved = decision.outcome === "approve_daily";
    assertExactKeys(
      decision,
      approved
        ? [
            "answerId",
            "sourceSha256",
            "outcome",
            "approvedEntrySha256",
            "approvedEntry",
            "reviews",
          ]
        : ["answerId", "sourceSha256", "outcome", "reviews"],
      `decisions[${index}]`,
    );
    if (decision.answerId !== batchDocument.batch.answerIds[index]) {
      throw new Error("Decisions and batch answerIds must use the same complete order.");
    }
    if (!DECISION_OUTCOMES.includes(decision.outcome)) {
      throw new Error(`Decision ${decision.answerId} has unsupported outcome ${decision.outcome}.`);
    }
    const source = sourceById.get(decision.answerId);
    if (decision.sourceSha256 !== source.sourceSha256) {
      throw new Error(`Decision ${decision.answerId} has a stale source hash.`);
    }
    validateReviewCoverage(decision, reviewers, `decisions[${index}]`);

    if (approved) {
      assertSha256(
        decision.approvedEntrySha256,
        `decisions[${index}].approvedEntrySha256`,
      );
      assertPlainObject(decision.approvedEntry, `decisions[${index}].approvedEntry`);
      if (decision.approvedEntry.id !== decision.answerId) {
        throw new Error(`Approved answer ${decision.answerId} must retain its immutable id.`);
      }
      if (decision.approvedEntry.word !== source.entry.word) {
        throw new Error(`Approved answer ${decision.answerId} must retain its immutable word identity.`);
      }
      if (sha256(decision.approvedEntry) !== decision.approvedEntrySha256) {
        throw new Error(`Approved answer ${decision.answerId} has a stale approved-entry hash.`);
      }
    }
    validateReconciledOutcome(decision, `decisions[${index}]`);
    outcomeCounts[decision.outcome] += 1;
  });

  assertExactKeys(
    decisionsDocument.summary,
    [
      "approved",
      "practiceOnly",
      "rejected",
      "needsRevision",
      "conflict",
      "incomplete",
      "total",
    ],
    "decisions document.summary",
  );
  for (const [outcome, summaryKey] of Object.entries(SUMMARY_KEYS_BY_OUTCOME)) {
    if (decisionsDocument.summary[summaryKey] !== outcomeCounts[outcome]) {
      throw new Error(`Decisions summary.${summaryKey} does not match its decisions.`);
    }
  }
  if (decisionsDocument.summary.incomplete !== 0) {
    throw new Error("Epoch proposals require a fully reconciled document with no incomplete entries.");
  }
  if (decisionsDocument.summary.total !== decisionsDocument.decisions.length) {
    throw new Error("Decisions summary.total does not match the complete batch.");
  }

  return decisionsDocument;
}

function validateEpochs(epochs, catalog) {
  if (!Array.isArray(epochs) || epochs.length === 0) {
    throw new Error("At least one existing daily epoch is required.");
  }
  epochs.forEach((epoch, index) => {
    assertPlainObject(epoch, `epochs[${index}]`);
    validateTiranaDate(epoch.start, `epochs[${index}].start`);
    if (index > 0 && epochs[index - 1].start >= epoch.start) {
      throw new Error("Existing daily epochs must be in strictly ascending start order.");
    }
    if (!Number.isSafeInteger(epoch.stepBase) || epoch.stepBase <= 0) {
      throw new Error(`epochs[${index}].stepBase must be a positive safe integer.`);
    }
    if (!Number.isSafeInteger(epoch.offset) || epoch.offset < 0) {
      throw new Error(`epochs[${index}].offset must be a non-negative safe integer.`);
    }
    if (Object.hasOwn(epoch, "answerIds")) {
      validateAnswerIds(epoch.answerIds, catalog, `epochs[${index}].answerIds`);
      if (!Object.isFrozen(epoch.answerIds)) {
        throw new Error(`epochs[${index}].answerIds must be frozen.`);
      }
      if (Object.hasOwn(epoch, "poolSize") && epoch.poolSize !== epoch.answerIds.length) {
        throw new Error(`epochs[${index}].poolSize must match answerIds.length.`);
      }
    } else {
      if (!Number.isSafeInteger(epoch.poolSize) || epoch.poolSize <= 0) {
        throw new Error(`epochs[${index}].poolSize must be a positive safe integer.`);
      }
      validateAnswerIds(
        Array.from({ length: epoch.poolSize }, (_, answerId) => answerId),
        catalog,
        `epochs[${index}] legacy pool`,
      );
    }
  });
}

export function currentDailyAnswerIds(epochs = DAILY_EPOCHS, answers = ANSWERS) {
  const catalog = answersById(answers);
  validateEpochs(epochs, catalog);
  const latest = epochs.at(-1);
  const ids = Object.hasOwn(latest, "answerIds")
    ? [...latest.answerIds]
    : Array.from({ length: latest.poolSize }, (_, answerId) => answerId);
  validateAnswerIds(ids, catalog, "current daily answerIds");
  return Object.freeze(ids);
}

function buildExcludedAnswerIds(decisions) {
  const result = {
    practiceOnly: [],
    rejected: [],
    needsRevision: [],
    conflict: [],
  };
  const keyByOutcome = {
    practice_only: "practiceOnly",
    reject_content: "rejected",
    needs_revision: "needsRevision",
    conflict: "conflict",
  };
  for (const decision of decisions) {
    if (decision.outcome !== "approve_daily") {
      result[keyByOutcome[decision.outcome]].push(decision.answerId);
    }
  }
  for (const key of Object.keys(result)) Object.freeze(result[key]);
  return Object.freeze(result);
}

function entryMapForProposal(answers, decisions) {
  const result = answersById(answers);
  for (const decision of decisions) {
    if (decision.outcome === "approve_daily") {
      result.set(decision.answerId, decision.approvedEntry);
    }
  }
  return result;
}

export function createEpochPreview({
  start,
  epoch,
  existingEpochs = DAILY_EPOCHS,
  entriesById,
  days = EPOCH_PREVIEW_DAYS,
}) {
  validateTiranaDate(start);
  if (!Number.isSafeInteger(days) || days <= 0) {
    throw new Error("Preview days must be a positive safe integer.");
  }
  if (!(entriesById instanceof Map)) {
    throw new TypeError("entriesById must be a Map.");
  }
  const epochs = Object.freeze([...existingEpochs, epoch]);
  const schedule = {};
  for (let day = 0; day < days; day += 1) {
    const date = addCalendarDays(start, day);
    const answerId = getDailyAnswerIndex(dateAtTiranaMidday(date), epochs);
    const answer = entriesById.get(answerId);
    if (answer === undefined) {
      throw new Error(`Preview resolved missing answer id ${answerId} on ${date}.`);
    }
    schedule[date] = Object.freeze({ answerId, word: answer.word });
  }
  Object.freeze(schedule);
  return Object.freeze({
    days,
    start,
    end: addCalendarDays(start, days - 1),
    schedule,
  });
}

export function proveFixtureHistoryUnchanged({
  start,
  fixture,
  publishedThrough,
  existingEpochs = DAILY_EPOCHS,
  proposedEpoch,
  answers = ANSWERS,
  fixtureLabel = "tests/fixtures/daily-schedule.json",
}) {
  validateTiranaDate(start);
  validateTiranaDate(publishedThrough, "publishedThrough");
  assertPlainObject(fixture, "daily schedule fixture");
  if (!Object.hasOwn(fixture, publishedThrough)) {
    throw new Error(
      `Daily schedule fixture must cover the published Tirana date ${publishedThrough}.`,
    );
  }
  const catalog = answersById(answers);
  const proposedEpochs = Object.freeze([...existingEpochs, proposedEpoch]);
  const fixturePrefix = [];
  const currentPrefix = [];
  const proposedPrefix = [];
  let previousDate = null;

  for (const [date, fixtureWord] of Object.entries(fixture)) {
    validateTiranaDate(date, "fixture date");
    if (previousDate !== null && addCalendarDays(previousDate, 1) !== date) {
      throw new Error("Daily schedule fixture must be strictly ordered and gapless.");
    }
    previousDate = date;
    if (typeof fixtureWord !== "string" || fixtureWord.trim() === "") {
      throw new Error(`Fixture answer for ${date} must be a word.`);
    }
    if (date >= start) continue;

    const instant = dateAtTiranaMidday(date);
    const currentId = getDailyAnswerIndex(instant, existingEpochs);
    const proposedId = getDailyAnswerIndex(instant, proposedEpochs);
    const currentWord = catalog.get(currentId)?.word;
    const proposedWord = catalog.get(proposedId)?.word;
    if (currentWord !== fixtureWord) {
      throw new Error(
        `Current daily history already differs from the fixture on ${date}: ` +
          `fixture=${fixtureWord}, current=${currentWord ?? "<missing>"}.`,
      );
    }
    if (proposedId !== currentId || proposedWord !== fixtureWord) {
      throw new Error(
        `Proposed epoch changes protected history on ${date}: ` +
          `fixture=${fixtureWord}, proposed=${proposedWord ?? "<missing>"}.`,
      );
    }
    fixturePrefix.push({ date, word: fixtureWord });
    currentPrefix.push({ date, word: currentWord });
    proposedPrefix.push({ date, word: proposedWord });
  }

  if (fixturePrefix.length === 0) {
    throw new Error("The fixture contains no published date before the proposed epoch start.");
  }
  const fixturePrefixSha256 = sha256(fixturePrefix);
  const currentPrefixSha256 = sha256(currentPrefix);
  const proposedPrefixSha256 = sha256(proposedPrefix);
  if (
    fixturePrefixSha256 !== currentPrefixSha256 ||
    fixturePrefixSha256 !== proposedPrefixSha256
  ) {
    throw new Error("Protected history hashes do not match.");
  }

  return Object.freeze({
    fixture: fixtureLabel,
    unchangedBefore: start,
    publishedThrough,
    checkedDates: fixturePrefix.length,
    firstCheckedDate: fixturePrefix[0].date,
    lastCheckedDate: fixturePrefix.at(-1).date,
    fixturePrefixSha256,
    currentPrefixSha256,
    proposedPrefixSha256,
    unchanged: true,
  });
}

export function buildEpochProposal({
  start,
  decisionsDocument,
  batchDocument,
  fixture,
  answers = ANSWERS,
  existingEpochs = DAILY_EPOCHS,
  proposalVersion = 1,
  generatedAt,
  publishedThrough,
  fixtureLabel = "tests/fixtures/daily-schedule.json",
}) {
  validateTiranaDate(start);
  assertIsoTimestamp(generatedAt, "generatedAt");
  const protectedThrough =
    publishedThrough === undefined
      ? getTiranaDateKeyForTimestamp(generatedAt)
      : validateTiranaDate(publishedThrough, "publishedThrough");
  if (!Number.isSafeInteger(proposalVersion) || proposalVersion <= 0) {
    throw new Error("proposalVersion must be a positive safe integer.");
  }
  const catalog = answersById(answers);
  validateEpochs(existingEpochs, catalog);
  validateDecisionsDocument(decisionsDocument, batchDocument, answers);
  const latestEpoch = existingEpochs.at(-1);
  if (start <= latestEpoch.start) {
    throw new Error(
      `Proposed start ${start} must be after the latest epoch start ${latestEpoch.start}.`,
    );
  }
  if (start <= protectedThrough) {
    throw new Error(
      `Proposed start ${start} must be after the published Tirana date ${protectedThrough}.`,
    );
  }

  const currentAnswerIds = currentDailyAnswerIds(existingEpochs, answers);
  const currentSet = new Set(currentAnswerIds);
  const approvedAnswerIds = decisionsDocument.decisions
    .filter(({ outcome }) => outcome === "approve_daily")
    .map(({ answerId }) => answerId);
  validateAnswerIds(approvedAnswerIds, catalog, "approved answerIds", { allowEmpty: true });
  const excludedAnswerIds = buildExcludedAnswerIds(decisionsDocument.decisions);
  const unresolvedAnswerIds = [
    ...excludedAnswerIds.needsRevision,
    ...excludedAnswerIds.conflict,
  ];
  if (unresolvedAnswerIds.length > 0) {
    throw new Error(
      "Epoch proposals require every candidate to have a resolved outcome; " +
        `needs_revision=${excludedAnswerIds.needsRevision.join(",") || "none"}; ` +
        `conflict=${excludedAnswerIds.conflict.join(",") || "none"}.`,
    );
  }
  const allExcludedAnswerIds = Object.freeze([
    ...excludedAnswerIds.practiceOnly,
    ...excludedAnswerIds.rejected,
    ...excludedAnswerIds.needsRevision,
    ...excludedAnswerIds.conflict,
  ]);
  const unsafeRetainedIds = allExcludedAnswerIds.filter((answerId) => currentSet.has(answerId));
  if (unsafeRetainedIds.length > 0) {
    throw new Error(
      "Refusing an unsafe proposal: current daily ids received non-approval outcomes: " +
        unsafeRetainedIds.join(", "),
    );
  }

  const answerIds = Object.freeze([
    ...currentAnswerIds,
    ...approvedAnswerIds.filter((answerId) => !currentSet.has(answerId)),
  ]);
  validateAnswerIds(answerIds, catalog, "proposed epoch answerIds");
  const epoch = Object.freeze({
    start,
    answerIds,
    poolSize: answerIds.length,
    stepBase: latestEpoch.stepBase,
    offset: latestEpoch.offset,
  });
  const entriesById = entryMapForProposal(answers, decisionsDocument.decisions);
  const preview = createEpochPreview({
    start,
    epoch,
    existingEpochs,
    entriesById,
  });
  const historyProof = proveFixtureHistoryUnchanged({
    start,
    fixture,
    publishedThrough: protectedThrough,
    existingEpochs,
    proposedEpoch: epoch,
    answers,
    fixtureLabel,
  });
  const proposalId = `epoch-${start}-${decisionsDocument.batch.id}-v${proposalVersion}`;

  return Object.freeze({
    schemaVersion: EPOCH_PROPOSAL_SCHEMA_VERSION,
    kind: EPOCH_PROPOSAL_KIND,
    proposal: Object.freeze({ id: proposalId, version: proposalVersion }),
    generatedAt,
    source: Object.freeze({
      decisionsBatchId: decisionsDocument.batch.id,
      sourceCatalogSha256: decisionsDocument.batch.sourceCatalogSha256,
      decisionsGeneratedAt: decisionsDocument.generatedAt,
      reviewers: Object.freeze([...decisionsDocument.reviewers]),
    }),
    publicationGuard: Object.freeze({
      timeZone: TIRANA_TIME_ZONE,
      publishedThrough: protectedThrough,
    }),
    approvedAnswerIds: Object.freeze([...approvedAnswerIds]),
    excludedAnswerIds,
    allExcludedAnswerIds,
    epoch,
    preview,
    historyProof,
  });
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function nextProposalVersion(existingNames, start, batchId) {
  validateTiranaDate(start);
  if (typeof batchId !== "string" || !BATCH_ID_PATTERN.test(batchId)) {
    throw new Error("batchId is not safe for a versioned proposal filename.");
  }
  if (!Array.isArray(existingNames)) {
    throw new TypeError("existingNames must be an array.");
  }
  const pattern = new RegExp(
    `^epoch-${escapeRegExp(start)}-${escapeRegExp(batchId)}-v(\\d+)\\.json$`,
    "u",
  );
  let latest = 0;
  for (const name of existingNames) {
    const match = pattern.exec(name);
    if (match === null) continue;
    const version = Number(match[1]);
    if (Number.isSafeInteger(version) && version > latest) latest = version;
  }
  return latest + 1;
}

export function proposalFilename(start, batchId, version) {
  validateTiranaDate(start);
  if (typeof batchId !== "string" || !BATCH_ID_PATTERN.test(batchId)) {
    throw new Error("batchId is not safe for a versioned proposal filename.");
  }
  if (!Number.isSafeInteger(version) || version <= 0) {
    throw new Error("version must be a positive safe integer.");
  }
  return `epoch-${start}-${batchId}-v${version}.json`;
}

async function atomicCreateJson(pathname, value) {
  await mkdir(dirname(pathname), { recursive: true });
  const temporaryPath = `${pathname}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await link(temporaryPath, pathname);
  } catch (error) {
    if (error.code === "EEXIST") {
      throw new Error(`Refusing to overwrite existing epoch proposal ${pathname}.`);
    }
    throw error;
  } finally {
    await unlink(temporaryPath).catch(() => {});
  }
}

async function readJson(pathname, label) {
  let source;
  try {
    source = await readFile(pathname, "utf8");
  } catch (error) {
    throw new Error(`Could not read ${label} ${pathname}: ${error.message}`);
  }
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`${label} ${pathname} is not valid JSON: ${error.message}`);
  }
}

export async function createEpochProposal({
  start,
  decisionsPath = DEFAULT_EDITORIAL_DECISIONS_PATH,
  batchesDir = DEFAULT_EDITORIAL_BATCHES_DIR,
  fixturePath = DEFAULT_DAILY_FIXTURE_PATH,
  proposalsDir = DEFAULT_EPOCH_PROPOSALS_DIR,
  generatedAt = new Date().toISOString(),
  publishedThrough,
} = {}) {
  validateTiranaDate(start);
  const decisionsDocument = await readJson(decisionsPath, "editorial decisions");
  const batchId = decisionsDocument?.batch?.id;
  if (typeof batchId !== "string" || !BATCH_ID_PATTERN.test(batchId)) {
    throw new Error("Editorial decisions do not name a safe frozen batch id.");
  }
  const batchPath = resolve(batchesDir, `${batchId}.json`);
  const [batchDocument, fixture] = await Promise.all([
    readJson(batchPath, "editorial batch"),
    readJson(fixturePath, "daily schedule fixture"),
  ]);
  let names = [];
  try {
    names = await readdir(proposalsDir);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const version = nextProposalVersion(names, start, batchId);
  const proposal = buildEpochProposal({
    start,
    decisionsDocument,
    batchDocument,
    fixture,
    proposalVersion: version,
    generatedAt,
    publishedThrough,
  });
  const pathname = resolve(proposalsDir, proposalFilename(start, batchId, version));
  await atomicCreateJson(pathname, proposal);
  return { pathname, proposal };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const args = process.argv.slice(2);
  if (args.length < 1 || args.length > 2) {
    console.error(
      "Usage: node scripts/build-epoch-proposal.mjs YYYY-MM-DD [editorial-decisions.json]",
    );
    process.exitCode = 1;
  } else {
    const [start, decisionsArgument] = args;
    const decisionsPath = decisionsArgument
      ? resolve(process.cwd(), decisionsArgument)
      : DEFAULT_EDITORIAL_DECISIONS_PATH;
    try {
      const { pathname, proposal } = await createEpochProposal({ start, decisionsPath });
      console.log(`Wrote ${pathname}.`);
      console.log(
        `Epoch ${proposal.epoch.start}: ${proposal.epoch.poolSize} answers; ` +
          `${proposal.approvedAnswerIds.length} approved; ` +
          `${proposal.allExcludedAnswerIds.length} excluded.`,
      );
      console.log(
        `Protected history: ${proposal.historyProof.checkedDates} fixture dates unchanged.`,
      );
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
