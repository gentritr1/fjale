import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_EDITORIAL_BATCH_PATH,
  EDITORIAL_BATCH_ID,
  canonicalJson,
  sha256,
} from "./build-editorial-batch.mjs";

export const EDITORIAL_HOST = "127.0.0.1";
export const DEFAULT_EDITORIAL_PORT = 4317;
export const REVIEW_KIND = "fjale-editorial-review";
export const RECONCILIATION_KIND = "fjale-editorial-reconciliation";
export const REVIEW_VERDICTS = Object.freeze([
  "approve_daily",
  "practice_only",
  "needs_revision",
  "reject_content",
]);

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_REVIEWS_DIR = resolve(REPOSITORY_ROOT, "editorial", "reviews", EDITORIAL_BATCH_ID);
const MAX_JSON_BODY_BYTES = 512 * 1024;
const REVIEW_LOCK_ACQUIRE_TIMEOUT_MS = 5_000;
const REVIEW_LOCK_RETRY_MS = 25;
const REVIEW_LOCK_STALE_MS = 30_000;
const REVIEW_LOCK_OWNER_FILENAME = "owner.json";
const REVIEW_LOCK_CANDIDATE_INFIX = ".candidate-";
const REVIEW_LOCK_REAPER_INFIX = ".reaping-";
const ACTIVE_REVIEW_LOCK_TOKENS = new Set();
const ACTIVE_REVIEW_TRANSITION_TOKENS = new Set();
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const REVIEWER_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{1,31}$/u;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const ALBANIAN_DIGRAPHS = new Set(["dh", "gj", "ll", "nj", "rr", "sh", "th", "xh", "zh"]);
const ALBANIAN_SINGLE_LETTERS = new Set([
  "a", "b", "c", "ç", "d", "e", "ë", "f", "g", "h", "i", "j", "k", "l",
  "m", "n", "o", "p", "q", "r", "s", "t", "u", "v", "x", "y", "z",
]);
const ENTRY_KEYS = Object.freeze([
  "id",
  "word",
  "partOfSpeech",
  "syllables",
  "clue",
  "definition",
  "example",
  "region",
]);
const ENTRY_STRING_LIMITS = Object.freeze({
  word: 32,
  partOfSpeech: 64,
  syllables: 64,
  clue: 300,
  definition: 600,
  example: 600,
  region: 64,
});
const SECURITY_HEADERS = Object.freeze({
  "Cache-Control": "no-store",
  "Content-Security-Policy": [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "font-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; "),
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
});

class RequestError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function assertPlainObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new RequestError(400, `${label} must be an object.`);
  }
}

function assertExactKeys(value, expectedKeys, label) {
  assertPlainObject(value, label);
  const expected = [...expectedKeys].sort();
  const received = Object.keys(value).sort();

  if (canonicalJson(received) !== canonicalJson(expected)) {
    throw new RequestError(
      400,
      `${label} must contain exactly: ${expected.join(", ")}.`,
    );
  }
}

function assertString(value, label, { maxLength, allowEmpty = false, multiline = false } = {}) {
  if (typeof value !== "string") {
    throw new RequestError(400, `${label} must be a string.`);
  }
  if (!allowEmpty && value.trim() === "") {
    throw new RequestError(400, `${label} must not be empty.`);
  }
  if (maxLength !== undefined && value.length > maxLength) {
    throw new RequestError(400, `${label} must be at most ${maxLength} characters.`);
  }
  const disallowedControls = multiline
    ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u
    : /[\u0000-\u001f\u007f]/u;
  if (disallowedControls.test(value)) {
    throw new RequestError(400, `${label} contains unsupported control characters.`);
  }
  if (value !== value.normalize("NFC")) {
    throw new RequestError(400, `${label} must use Unicode NFC normalization.`);
  }
}

function assertSha256(value, label) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new RequestError(400, `${label} must be a lowercase SHA-256 digest.`);
  }
}

function assertIsoTimestamp(value, label) {
  if (
    typeof value !== "string" ||
    !ISO_TIMESTAMP_PATTERN.test(value) ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new RequestError(400, `${label} must be an ISO-8601 UTC timestamp.`);
  }
}

function tokenizeAlbanian(word) {
  const normalized = word.toLocaleLowerCase("sq-AL");
  const tokens = [];

  for (let index = 0; index < normalized.length; ) {
    const pair = normalized.slice(index, index + 2);
    if (ALBANIAN_DIGRAPHS.has(pair)) {
      tokens.push(pair);
      index += 2;
      continue;
    }
    const letter = normalized[index];
    if (!ALBANIAN_SINGLE_LETTERS.has(letter)) return null;
    tokens.push(letter);
    index += 1;
  }

  return tokens;
}

export function validateEditorialEntry(
  entry,
  answerId,
  label = "proposedEntry",
  expectedWord,
) {
  assertExactKeys(entry, ENTRY_KEYS, label);

  if (!Number.isSafeInteger(entry.id) || entry.id !== answerId) {
    throw new RequestError(400, `${label}.id must equal answerId ${answerId}.`);
  }

  for (const [field, maxLength] of Object.entries(ENTRY_STRING_LIMITS)) {
    assertString(entry[field], `${label}.${field}`, { maxLength });
  }

  if (entry.word !== entry.word.toLocaleLowerCase("sq-AL")) {
    throw new RequestError(400, `${label}.word must be lowercase Albanian.`);
  }
  if (expectedWord !== undefined && entry.word !== expectedWord) {
    throw new RequestError(
      409,
      `${label}.word must remain ${JSON.stringify(expectedWord)} for immutable answer id ${answerId}.`,
    );
  }
  const tokens = tokenizeAlbanian(entry.word);
  if (tokens === null || tokens.length !== 5) {
    throw new RequestError(400, `${label}.word must contain exactly five Albanian letters.`);
  }
  const syllableWord = entry.syllables.replaceAll("-", "").toLocaleLowerCase("sq-AL");
  if (syllableWord !== entry.word) {
    throw new RequestError(
      400,
      `${label}.syllables must reproduce the word when hyphens are removed.`,
    );
  }
  if (entry.region !== "standard") {
    throw new RequestError(400, `${label}.region must remain standard for this batch.`);
  }

  return entry;
}

export function validateBatchDocument(batch) {
  assertExactKeys(batch, ["schemaVersion", "kind", "batch", "entries"], "batch document");
  if (batch.schemaVersion !== 1 || batch.kind !== "fjale-editorial-batch") {
    throw new RequestError(400, "Unsupported editorial batch format.");
  }
  assertExactKeys(
    batch.batch,
    ["id", "sourceCatalogSha256", "answerIds"],
    "batch document.batch",
  );
  assertString(batch.batch.id, "batch document.batch.id", { maxLength: 100 });
  assertSha256(batch.batch.sourceCatalogSha256, "batch document.batch.sourceCatalogSha256");
  if (!Array.isArray(batch.batch.answerIds) || !Array.isArray(batch.entries)) {
    throw new RequestError(400, "Batch answerIds and entries must be arrays.");
  }
  if (batch.entries.length === 0 || batch.entries.length !== batch.batch.answerIds.length) {
    throw new RequestError(400, "Batch answerIds must cover every entry exactly once.");
  }

  const seenIds = new Set();
  batch.entries.forEach((item, index) => {
    assertExactKeys(item, ["answerId", "sourceSha256", "entry"], `batch entries[${index}]`);
    if (!Number.isSafeInteger(item.answerId) || seenIds.has(item.answerId)) {
      throw new RequestError(400, `Batch entries[${index}].answerId must be unique.`);
    }
    if (batch.batch.answerIds[index] !== item.answerId) {
      throw new RequestError(400, "Batch answerIds must match entry order exactly.");
    }
    assertSha256(item.sourceSha256, `batch entries[${index}].sourceSha256`);
    validateEditorialEntry(item.entry, item.answerId, `batch entries[${index}].entry`);
    if (sha256(item.entry) !== item.sourceSha256) {
      throw new RequestError(400, `Batch entry ${item.answerId} has a stale source hash.`);
    }
    seenIds.add(item.answerId);
  });

  if (sha256(batch.entries) !== batch.batch.sourceCatalogSha256) {
    throw new RequestError(400, "Batch source catalog hash is stale.");
  }

  return batch;
}

function validateReviewerId(value, label = "reviewer id") {
  if (typeof value !== "string" || !REVIEWER_ID_PATTERN.test(value)) {
    throw new RequestError(
      400,
      `${label} must use 2-32 lowercase letters, digits, underscores, or hyphens.`,
    );
  }
  return value;
}

function assertMatchingBatchReference(reference, batch, label) {
  assertExactKeys(reference, ["id", "sourceCatalogSha256", "answerIds"], label);
  if (
    reference.id !== batch.batch.id ||
    reference.sourceCatalogSha256 !== batch.batch.sourceCatalogSha256 ||
    canonicalJson(reference.answerIds) !== canonicalJson(batch.batch.answerIds)
  ) {
    throw new RequestError(409, `${label} does not match the frozen editorial batch.`);
  }
}

function validateDecision(decision, index, batchEntriesById) {
  const label = `decisions[${index}]`;
  assertExactKeys(
    decision,
    [
      "answerId",
      "sourceSha256",
      "verdict",
      "proposedEntry",
      "reason",
      "notes",
      "reviewedAt",
    ],
    label,
  );
  if (!Number.isSafeInteger(decision.answerId)) {
    throw new RequestError(400, `${label}.answerId must be an integer.`);
  }
  const source = batchEntriesById.get(decision.answerId);
  if (source === undefined) {
    throw new RequestError(400, `${label}.answerId is not part of this batch.`);
  }
  assertSha256(decision.sourceSha256, `${label}.sourceSha256`);
  if (decision.sourceSha256 !== source.sourceSha256) {
    throw new RequestError(409, `${label}.sourceSha256 does not match the frozen entry.`);
  }
  if (!REVIEW_VERDICTS.includes(decision.verdict)) {
    throw new RequestError(400, `${label}.verdict is not supported.`);
  }
  assertString(decision.reason, `${label}.reason`, { maxLength: 1_000, allowEmpty: true, multiline: true });
  assertString(decision.notes, `${label}.notes`, { maxLength: 4_000, allowEmpty: true, multiline: true });
  assertIsoTimestamp(decision.reviewedAt, `${label}.reviewedAt`);

  if (decision.verdict === "approve_daily" && decision.reason.trim() !== "") {
    throw new RequestError(400, `${label}.reason must be empty for approve_daily.`);
  }
  if (decision.verdict !== "approve_daily" && decision.reason.trim() === "") {
    throw new RequestError(400, `${label}.reason is required for ${decision.verdict}.`);
  }

  if (decision.proposedEntry === null) {
    if (decision.verdict !== "reject_content") {
      throw new RequestError(400, `${label}.proposedEntry may be null only for reject_content.`);
    }
  } else {
    validateEditorialEntry(
      decision.proposedEntry,
      decision.answerId,
      `${label}.proposedEntry`,
      source.entry.word,
    );
  }

  return decision;
}

export function validateReviewDocument(review, batch, expectedReviewerId) {
  validateBatchDocument(batch);
  assertPlainObject(review, "review document");
  const requiredReviewKeys = [
    "schemaVersion",
    "kind",
    "batch",
    "reviewer",
    "decisions",
    "startedAt",
    "updatedAt",
  ];
  const reviewKeys = Object.keys(review).sort();
  const withoutDrafts = [...requiredReviewKeys].sort();
  const withDrafts = [...requiredReviewKeys, "drafts"].sort();
  if (
    canonicalJson(reviewKeys) !== canonicalJson(withoutDrafts) &&
    canonicalJson(reviewKeys) !== canonicalJson(withDrafts)
  ) {
    throw new RequestError(
      400,
      `review document must contain exactly: ${withDrafts.join(", ")} ` +
        "(drafts may be omitted).",
    );
  }
  if (review.schemaVersion !== 1 || review.kind !== REVIEW_KIND) {
    throw new RequestError(400, "Unsupported editorial review format.");
  }
  assertMatchingBatchReference(review.batch, batch, "review document.batch");
  assertExactKeys(review.reviewer, ["id"], "review document.reviewer");
  validateReviewerId(review.reviewer.id, "review document.reviewer.id");
  if (expectedReviewerId !== undefined && review.reviewer.id !== expectedReviewerId) {
    throw new RequestError(409, "Reviewer id does not match the requested review file.");
  }
  assertIsoTimestamp(review.startedAt, "review document.startedAt");
  assertIsoTimestamp(review.updatedAt, "review document.updatedAt");
  if (Date.parse(review.updatedAt) < Date.parse(review.startedAt)) {
    throw new RequestError(400, "review document.updatedAt must not precede startedAt.");
  }
  if (!Array.isArray(review.decisions)) {
    throw new RequestError(400, "review document.decisions must be an array.");
  }
  if (review.drafts !== undefined && !Array.isArray(review.drafts)) {
    throw new RequestError(400, "review document.drafts must be an array when provided.");
  }
  if (review.decisions.length > batch.entries.length) {
    throw new RequestError(400, "A review cannot contain more decisions than the batch.");
  }
  if ((review.drafts?.length ?? 0) > batch.entries.length) {
    throw new RequestError(400, "A review cannot contain more drafts than the batch.");
  }

  const entriesById = new Map(batch.entries.map((entry) => [entry.answerId, entry]));
  const seenIds = new Set();
  for (const [index, decision] of review.decisions.entries()) {
    validateDecision(decision, index, entriesById);
    if (seenIds.has(decision.answerId)) {
      throw new RequestError(400, `Duplicate decision for answer ${decision.answerId}.`);
    }
    if (Date.parse(decision.reviewedAt) > Date.parse(review.updatedAt)) {
      throw new RequestError(400, `Decision ${decision.answerId} is newer than review updatedAt.`);
    }
    seenIds.add(decision.answerId);
  }

  const seenDraftIds = new Set();
  for (const [index, draft] of (review.drafts ?? []).entries()) {
    const label = `drafts[${index}]`;
    assertExactKeys(
      draft,
      ["answerId", "sourceSha256", "proposedEntry", "notes", "updatedAt"],
      label,
    );
    if (!Number.isSafeInteger(draft.answerId)) {
      throw new RequestError(400, `${label}.answerId must be an integer.`);
    }
    if (seenIds.has(draft.answerId)) {
      throw new RequestError(
        400,
        `Answer ${draft.answerId} cannot appear in both decisions and drafts.`,
      );
    }
    const source = entriesById.get(draft.answerId);
    if (source === undefined) {
      throw new RequestError(400, `${label}.answerId is not part of this batch.`);
    }
    assertSha256(draft.sourceSha256, `${label}.sourceSha256`);
    if (draft.sourceSha256 !== source.sourceSha256) {
      throw new RequestError(409, `${label}.sourceSha256 does not match the frozen entry.`);
    }
    validateEditorialEntry(
      draft.proposedEntry,
      draft.answerId,
      `${label}.proposedEntry`,
      source.entry.word,
    );
    assertString(draft.notes, `${label}.notes`, {
      maxLength: 4_000,
      allowEmpty: true,
      multiline: true,
    });
    assertIsoTimestamp(draft.updatedAt, `${label}.updatedAt`);
    if (Date.parse(draft.updatedAt) > Date.parse(review.updatedAt)) {
      throw new RequestError(400, `Draft ${draft.answerId} is newer than review updatedAt.`);
    }
    if (seenDraftIds.has(draft.answerId)) {
      throw new RequestError(400, `Duplicate draft for answer ${draft.answerId}.`);
    }
    seenDraftIds.add(draft.answerId);
  }

  return review;
}

export function createEmptyReview(batch, reviewerId, timestamp = new Date().toISOString()) {
  validateReviewerId(reviewerId);
  return {
    schemaVersion: 1,
    kind: REVIEW_KIND,
    batch: structuredClone(batch.batch),
    reviewer: { id: reviewerId },
    decisions: [],
    drafts: [],
    startedAt: timestamp,
    updatedAt: timestamp,
  };
}

export async function readEditorialBatch(pathname = DEFAULT_EDITORIAL_BATCH_PATH) {
  const source = await readFile(pathname, "utf8");
  return validateBatchDocument(JSON.parse(source));
}

function reviewPath(reviewsDir, reviewerId) {
  validateReviewerId(reviewerId);
  return resolve(reviewsDir, `reviewer-${reviewerId}.json`);
}

function reviewLockPath(reviewsDir, reviewerId) {
  validateReviewerId(reviewerId);
  return resolve(reviewsDir, `.reviewer-${reviewerId}.lock`);
}

function isErrnoException(error, code) {
  return error !== null && typeof error === "object" && error.code === code;
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !isErrnoException(error, "ESRCH");
  }
}

function isLockTimestamp(value) {
  return (
    typeof value === "string" &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function isValidLockOwner(owner) {
  return (
    owner !== null &&
    typeof owner === "object" &&
    !Array.isArray(owner) &&
    typeof owner.token === "string" &&
    owner.token.length > 0 &&
    Number.isSafeInteger(owner.pid) &&
    owner.pid > 0 &&
    isLockTimestamp(owner.createdAt) &&
    (owner.completedAt === undefined ||
      owner.completedAt === null ||
      isLockTimestamp(owner.completedAt))
  );
}

function isCompletedLockOwner(owner) {
  return isValidLockOwner(owner) && owner.completedAt !== undefined && owner.completedAt !== null;
}

async function createLockOwner(token) {
  return {
    token,
    pid: process.pid,
    createdAt: new Date().toISOString(),
    completedAt: null,
  };
}

function isLockOwnerProcessActive(owner, activeTokens) {
  if (!isProcessAlive(owner.pid)) return false;
  if (owner.pid === process.pid) return activeTokens.has(owner.token);
  // Another live PID is treated conservatively. An OS-level PID reuse by an
  // unrelated process can require manual cleanup, but can never steal a lock
  // from a paused legitimate writer.
  return true;
}

async function readReviewLockOwner(lockPathname) {
  try {
    return JSON.parse(
      await readFile(resolve(lockPathname, REVIEW_LOCK_OWNER_FILENAME), "utf8"),
    );
  } catch (error) {
    if (
      isErrnoException(error, "ENOENT") ||
      isErrnoException(error, "ENOTDIR") ||
      error instanceof SyntaxError
    ) {
      return undefined;
    }
    throw error;
  }
}

async function isReviewLockAbandoned(lockPathname, staleMs) {
  let lockStat;
  try {
    lockStat = await stat(lockPathname);
  } catch (error) {
    if (isErrnoException(error, "ENOENT")) return false;
    throw error;
  }

  const owner = await readReviewLockOwner(lockPathname);
  if (isValidLockOwner(owner)) {
    return (
      isCompletedLockOwner(owner) ||
      !isLockOwnerProcessActive(owner, ACTIVE_REVIEW_LOCK_TOKENS)
    );
  }

  return Date.now() - lockStat.mtimeMs >= staleMs;
}

async function readReviewReaperOwner(reaperPathname) {
  try {
    return JSON.parse(await readFile(reaperPathname, "utf8"));
  } catch (error) {
    if (isErrnoException(error, "ENOENT") || error instanceof SyntaxError) {
      return undefined;
    }
    throw error;
  }
}

async function listActiveReviewReapers(lockPathname, staleMs) {
  const directory = dirname(lockPathname);
  const prefix = `${basename(lockPathname)}${REVIEW_LOCK_REAPER_INFIX}`;
  let names;
  try {
    names = await readdir(directory);
  } catch (error) {
    if (isErrnoException(error, "ENOENT")) return [];
    throw error;
  }

  const active = [];
  for (const name of names.filter((candidate) => candidate.startsWith(prefix))) {
    const reaperPathname = resolve(directory, name);
    let reaperStat;
    try {
      reaperStat = await stat(reaperPathname);
    } catch (error) {
      if (isErrnoException(error, "ENOENT")) continue;
      throw error;
    }
    const owner = await readReviewReaperOwner(reaperPathname);
    const abandoned = isValidLockOwner(owner)
      ? isCompletedLockOwner(owner) ||
        !isLockOwnerProcessActive(owner, ACTIVE_REVIEW_TRANSITION_TOKENS)
      : Date.now() - reaperStat.mtimeMs >= staleMs;
    if (abandoned) {
      await unlink(reaperPathname).catch((error) => {
        if (!isErrnoException(error, "ENOENT")) throw error;
      });
    } else {
      active.push(reaperPathname);
    }
  }
  return active;
}

async function unlinkIfPresent(pathname) {
  try {
    await unlink(pathname);
  } catch (error) {
    if (!isErrnoException(error, "ENOENT")) throw error;
  }
}

async function createReviewTransitionMarker(lockPathname, purpose) {
  const token = randomUUID();
  // Unique sibling markers make lock transitions visible to acquisitions.
  // A marker from a crashed process can be removed by its unique pathname
  // without touching a successor's marker.
  const pathname =
    `${lockPathname}${REVIEW_LOCK_REAPER_INFIX}${purpose}-${token}`;
  const owner = await createLockOwner(token);
  ACTIVE_REVIEW_TRANSITION_TOKENS.add(token);
  try {
    await writeFile(
      pathname,
      `${JSON.stringify(owner)}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );
  } catch (error) {
    ACTIVE_REVIEW_TRANSITION_TOKENS.delete(token);
    throw error;
  }
  return { pathname, token, owner };
}

async function closeReviewTransitionMarker(marker) {
  const completedOwner = {
    ...marker.owner,
    completedAt: new Date().toISOString(),
  };
  let completionError;
  try {
    await writeFile(marker.pathname, `${JSON.stringify(completedOwner)}\n`, {
      encoding: "utf8",
      flag: "w",
      mode: 0o600,
    });
  } catch (error) {
    completionError = error;
  } finally {
    ACTIVE_REVIEW_TRANSITION_TOKENS.delete(marker.token);
  }

  try {
    await unlinkIfPresent(marker.pathname);
  } catch (error) {
    if (completionError === undefined) completionError = error;
  }
  if (completionError !== undefined) throw completionError;
}

async function reapAbandonedReviewLock(lockPathname, staleMs) {
  const marker = await createReviewTransitionMarker(lockPathname, "reap");

  const abandonedPathname = `${lockPathname}.abandoned-${marker.token}`;
  try {
    if (!(await isReviewLockAbandoned(lockPathname, staleMs))) return false;
    try {
      await rename(lockPathname, abandonedPathname);
    } catch (error) {
      if (isErrnoException(error, "ENOENT")) return false;
      throw error;
    }
    await rm(abandonedPathname, { recursive: true, force: true });
    return true;
  } finally {
    await closeReviewTransitionMarker(marker);
  }
}

async function createReviewLockCandidate(lockPathname, token) {
  const candidatePathname =
    `${lockPathname}${REVIEW_LOCK_CANDIDATE_INFIX}${token}`;
  await mkdir(candidatePathname, { mode: 0o700 });
  try {
    const owner = await createLockOwner(token);
    await writeFile(
      resolve(candidatePathname, REVIEW_LOCK_OWNER_FILENAME),
      `${JSON.stringify(owner)}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );
  } catch (error) {
    await rm(candidatePathname, { recursive: true, force: true });
    throw error;
  }
  return candidatePathname;
}

function isReviewLockContention(error) {
  return (
    isErrnoException(error, "EEXIST") ||
    isErrnoException(error, "ENOTEMPTY") ||
    isErrnoException(error, "ENOTDIR")
  );
}

async function removeReviewLockIfOwned(lockPathname, token, disposition) {
  // Cleanup is also a state transition. Its marker prevents an acquirer that
  // observed a temporary gap from entering before read/rename verification
  // finishes, including when an older reaper resumes late.
  const marker = await createReviewTransitionMarker(lockPathname, disposition);
  try {
    const owner = await readReviewLockOwner(lockPathname);
    if (!isValidLockOwner(owner) || owner.token !== token) return false;

    const completedOwner = {
      ...owner,
      completedAt: new Date().toISOString(),
    };
    const ownerPathname = resolve(lockPathname, REVIEW_LOCK_OWNER_FILENAME);
    const completedOwnerPathname = resolve(lockPathname, `.owner-completed-${marker.token}`);
    await writeFile(completedOwnerPathname, `${JSON.stringify(completedOwner)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await rename(completedOwnerPathname, ownerPathname);

    const retiredPathname = `${lockPathname}.${disposition}-${token}`;
    try {
      await rename(lockPathname, retiredPathname);
    } catch (error) {
      if (isErrnoException(error, "ENOENT")) return false;
      throw error;
    }

    const retiredOwner = await readReviewLockOwner(retiredPathname);
    if (!isValidLockOwner(retiredOwner) || retiredOwner.token !== token) {
      throw new Error("Review lock ownership changed during cleanup.");
    }
    await rm(retiredPathname, { recursive: true, force: true });
    return true;
  } finally {
    await closeReviewTransitionMarker(marker);
  }
}

function assertReviewLockOptions({ acquireTimeoutMs, retryMs, staleMs }) {
  for (const [label, value] of Object.entries({ acquireTimeoutMs, retryMs, staleMs })) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new TypeError(`${label} must be a positive finite number.`);
    }
  }
}

function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

function reviewLockBusyError() {
  return new RequestError(
    503,
    "Review is busy in another process. Try saving again after it finishes.",
  );
}

async function waitForReviewReapers(
  lockPathname,
  { acquireTimeoutMs, retryMs, staleMs },
  startedAt,
) {
  while ((await listActiveReviewReapers(lockPathname, staleMs)).length > 0) {
    const remainingMs = acquireTimeoutMs - (performance.now() - startedAt);
    if (remainingMs <= 0) throw reviewLockBusyError();
    await wait(Math.min(retryMs, remainingMs));
  }
}

async function acquireReviewLock(
  reviewsDir,
  reviewerId,
  {
    acquireTimeoutMs = REVIEW_LOCK_ACQUIRE_TIMEOUT_MS,
    retryMs = REVIEW_LOCK_RETRY_MS,
    staleMs = REVIEW_LOCK_STALE_MS,
  } = {},
) {
  assertReviewLockOptions({ acquireTimeoutMs, retryMs, staleMs });
  await mkdir(reviewsDir, { recursive: true, mode: 0o700 });
  const lockPathname = reviewLockPath(reviewsDir, reviewerId);
  const startedAt = performance.now();

  while (true) {
    await waitForReviewReapers(
      lockPathname,
      { acquireTimeoutMs, retryMs, staleMs },
      startedAt,
    );
    const token = randomUUID();
    const candidatePathname = await createReviewLockCandidate(lockPathname, token);
    let installed = false;
    try {
      await rename(candidatePathname, lockPathname);
      installed = true;
    } catch (error) {
      if (!isReviewLockContention(error)) throw error;
    } finally {
      if (!installed) {
        await rm(candidatePathname, { recursive: true, force: true });
      }
    }

    if (installed) {
      ACTIVE_REVIEW_LOCK_TOKENS.add(token);
      try {
        await waitForReviewReapers(
          lockPathname,
          { acquireTimeoutMs, retryMs, staleMs },
          startedAt,
        );
      } catch (error) {
        try {
          await removeReviewLockIfOwned(lockPathname, token, "cancelled");
        } finally {
          ACTIVE_REVIEW_LOCK_TOKENS.delete(token);
        }
        throw error;
      }
      const owner = await readReviewLockOwner(lockPathname);
      if (isValidLockOwner(owner) && owner.token === token) {
        return async () => {
          try {
            await removeReviewLockIfOwned(lockPathname, token, "released");
          } finally {
            ACTIVE_REVIEW_LOCK_TOKENS.delete(token);
          }
        };
      }
      ACTIVE_REVIEW_LOCK_TOKENS.delete(token);
      continue;
    }

    if (await reapAbandonedReviewLock(lockPathname, staleMs)) continue;

    const remainingMs = acquireTimeoutMs - (performance.now() - startedAt);
    if (remainingMs <= 0) {
      throw reviewLockBusyError();
    }
    await wait(Math.min(retryMs, remainingMs));
  }
}

export async function withReviewFileLock(
  reviewsDir,
  reviewerId,
  operation,
  lockOptions,
) {
  const release = await acquireReviewLock(reviewsDir, reviewerId, lockOptions);
  try {
    return await operation();
  } finally {
    await release();
  }
}

async function readReviewIfPresent(reviewsDir, reviewerId, batch) {
  const pathname = reviewPath(reviewsDir, reviewerId);
  try {
    const source = await readFile(pathname, "utf8");
    return validateReviewDocument(JSON.parse(source), batch, reviewerId);
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

export async function atomicWriteReview(reviewsDir, review) {
  const pathname = reviewPath(reviewsDir, review.reviewer.id);
  await mkdir(reviewsDir, { recursive: true });
  const temporaryPath = resolve(
    reviewsDir,
    `.reviewer-${review.reviewer.id}.${process.pid}.${Date.now()}.tmp`,
  );

  try {
    await writeFile(temporaryPath, `${JSON.stringify(review, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporaryPath, pathname);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }

  return pathname;
}

export async function loadEditorialReviews(reviewsDir, batch) {
  let names;
  try {
    names = await readdir(reviewsDir);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }

  const reviewerIds = names
    .map((name) => /^reviewer-([a-z0-9][a-z0-9_-]{1,31})\.json$/u.exec(name)?.[1])
    .filter(Boolean)
    .sort();
  const reviews = [];
  for (const reviewerId of reviewerIds) {
    reviews.push(await readReviewIfPresent(reviewsDir, reviewerId, batch));
  }
  return reviews;
}

export function buildReconciliation(
  batch,
  reviews,
  generatedAt = new Date().toISOString(),
  { minimumReviewerCount = 2 } = {},
) {
  if (!Number.isSafeInteger(minimumReviewerCount) || minimumReviewerCount < 1) {
    throw new TypeError("minimumReviewerCount must be a positive safe integer.");
  }
  const normalizedReviews = [...reviews].sort((a, b) =>
    a.reviewer.id.localeCompare(b.reviewer.id, "en"),
  );
  const reviewMaps = normalizedReviews.map((review) => ({
    reviewerId: review.reviewer.id,
    decisions: new Map(review.decisions.map((decision) => [decision.answerId, decision])),
  }));
  const entries = batch.entries.map((source) => {
    const decisions = reviewMaps.flatMap(({ reviewerId, decisions: decisionMap }) => {
      const decision = decisionMap.get(source.answerId);
      if (decision === undefined) return [];
      return [
        {
          reviewerId,
          verdict: decision.verdict,
          proposedEntrySha256:
            decision.proposedEntry === null ? null : sha256(decision.proposedEntry),
          reason: decision.reason,
          notes: decision.notes,
          reviewedAt: decision.reviewedAt,
        },
      ];
    });
    const hasCompleteReviewerCoverage =
      decisions.length >= minimumReviewerCount && decisions.length === reviewMaps.length;
    let state = "incomplete";
    let approvedEntrySha256 = null;

    if (hasCompleteReviewerCoverage) {
      const verdicts = new Set(decisions.map(({ verdict }) => verdict));
      if (verdicts.size !== 1) {
        state = "conflict";
      } else {
        const [unanimousVerdict] = verdicts;
        if (unanimousVerdict === "approve_daily" || unanimousVerdict === "practice_only") {
          const proposedEntryDigests = new Set(
            decisions.map(({ proposedEntrySha256 }) => proposedEntrySha256),
          );
          if (proposedEntryDigests.size !== 1 || proposedEntryDigests.has(null)) {
            state = "conflict";
          } else {
            state = unanimousVerdict;
            if (unanimousVerdict === "approve_daily") {
              [approvedEntrySha256] = proposedEntryDigests;
            }
          }
        } else {
          // A rejection is final even when reviewers give different reasons or
          // omit a proposed entry. A revision request is intentionally not a
          // merge: a human must edit the candidate before a later approval.
          state = unanimousVerdict;
        }
      }
    }

    return {
      answerId: source.answerId,
      sourceSha256: source.sourceSha256,
      word: source.entry.word,
      state,
      approvedEntrySha256,
      decisions,
    };
  });
  const coverage = reviewMaps.map(({ reviewerId, decisions }) => ({
    reviewerId,
    decided: decisions.size,
    total: batch.entries.length,
    complete: decisions.size === batch.entries.length,
  }));

  return {
    schemaVersion: 1,
    kind: RECONCILIATION_KIND,
    batch: structuredClone(batch.batch),
    generatedAt,
    reviewers: coverage,
    summary: {
      approved: entries.filter(({ state }) => state === "approve_daily").length,
      practiceOnly: entries.filter(({ state }) => state === "practice_only").length,
      rejected: entries.filter(({ state }) => state === "reject_content").length,
      needsRevision: entries.filter(({ state }) => state === "needs_revision").length,
      conflict: entries.filter(({ state }) => state === "conflict").length,
      incomplete: entries.filter(({ state }) => state === "incomplete").length,
      total: entries.length,
    },
    entries,
  };
}

async function readJsonBody(request) {
  const contentType = request.headers["content-type"]?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new RequestError(415, "Content-Type must be application/json.");
  }
  const declaredLength = Number(request.headers["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_BYTES) {
    throw new RequestError(413, "Editorial review payload is too large.");
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_JSON_BODY_BYTES) {
      throw new RequestError(413, "Editorial review payload is too large.");
    }
    chunks.push(chunk);
  }
  if (size === 0) throw new RequestError(400, "JSON request body is required.");

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new RequestError(400, "Request body is not valid JSON.");
  }
}

function send(response, statusCode, body, contentType, extraHeaders = {}) {
  response.writeHead(statusCode, {
    ...SECURITY_HEADERS,
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body),
    ...extraHeaders,
  });
  response.end(body);
}

function sendJson(response, statusCode, value, extraHeaders = {}) {
  send(
    response,
    statusCode,
    `${JSON.stringify(value)}\n`,
    "application/json; charset=utf-8",
    extraHeaders,
  );
}

function reviewEtag(review) {
  return `"sha256-${sha256(review)}"`;
}

function assertLocalOrigin(request) {
  const host = request.headers.host ?? "";
  const hostname = host.startsWith("[") ? host.slice(1, host.indexOf("]")) : host.split(":", 1)[0];
  if (hostname !== EDITORIAL_HOST) {
    throw new RequestError(403, "The editorial server is available only on 127.0.0.1.");
  }
  const origin = request.headers.origin;
  if (origin !== undefined) {
    let originUrl;
    try {
      originUrl = new URL(origin);
    } catch {
      throw new RequestError(403, "Request origin is not allowed.");
    }
    if (originUrl.protocol !== "http:" || originUrl.host !== host) {
      throw new RequestError(403, "Request origin is not allowed.");
    }
  }
}

export function createEditorialRequestHandler({
  repositoryRoot = REPOSITORY_ROOT,
  batchPath = DEFAULT_EDITORIAL_BATCH_PATH,
  reviewsDir = DEFAULT_REVIEWS_DIR,
  now = () => new Date().toISOString(),
  reviewLockOptions,
  reviewWriter = atomicWriteReview,
} = {}) {
  const staticFiles = new Map([
    ["/admin", [resolve(repositoryRoot, "editor", "index.html"), "text/html; charset=utf-8"]],
    ["/admin/", [resolve(repositoryRoot, "editor", "index.html"), "text/html; charset=utf-8"]],
    ["/admin/editor.css", [resolve(repositoryRoot, "editor", "editor.css"), "text/css; charset=utf-8"]],
    ["/admin/editor.js", [resolve(repositoryRoot, "editor", "editor.js"), "text/javascript; charset=utf-8"]],
    ["/admin/review-merge.js", [resolve(repositoryRoot, "editor", "review-merge.js"), "text/javascript; charset=utf-8"]],
    ["/favicon.svg", [resolve(repositoryRoot, "favicon.svg"), "image/svg+xml"]],
  ]);
  return async (request, response) => {
    try {
      assertLocalOrigin(request);
      const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host}`);

      if (request.method === "GET" && staticFiles.has(requestUrl.pathname)) {
        if (requestUrl.search !== "") throw new RequestError(404, "Not found.");
        const [pathname, contentType] = staticFiles.get(requestUrl.pathname);
        send(response, 200, await readFile(pathname), contentType);
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/editorial/batch") {
        if (requestUrl.search !== "") throw new RequestError(400, "Batch endpoint accepts no query parameters.");
        sendJson(response, 200, await readEditorialBatch(batchPath));
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/editorial/review") {
        if ([...requestUrl.searchParams.keys()].some((key) => key !== "reviewer")) {
          throw new RequestError(400, "Review endpoint accepts only the reviewer query parameter.");
        }
        const reviewerValues = requestUrl.searchParams.getAll("reviewer");
        if (reviewerValues.length !== 1) {
          throw new RequestError(400, "Exactly one reviewer query parameter is required.");
        }
        const reviewerId = validateReviewerId(reviewerValues[0]);
        const batch = await readEditorialBatch(batchPath);
        const review = await readReviewIfPresent(reviewsDir, reviewerId, batch);
        if (review === undefined) {
          sendJson(response, 404, { error: "No saved review exists for this reviewer." });
          return;
        }
        sendJson(response, 200, review, { ETag: reviewEtag(review) });
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/editorial/review") {
        if (requestUrl.search !== "") throw new RequestError(400, "Review save endpoint accepts no query parameters.");
        const batch = await readEditorialBatch(batchPath);
        const review = validateReviewDocument(await readJsonBody(request), batch);
        review.drafts ??= [];
        const saveResult = await withReviewFileLock(reviewsDir, review.reviewer.id, async () => {
          const existing = await readReviewIfPresent(reviewsDir, review.reviewer.id, batch);
          if (existing === undefined) {
            if (request.headers["if-none-match"] !== "*") {
              throw new RequestError(
                409,
                "Review creation requires a current empty-state token. Reload and merge the local backup.",
              );
            }
          } else {
            if (request.headers["if-match"] !== reviewEtag(existing)) {
              throw new RequestError(
                409,
                "Review changed in another tab. Reload and merge before saving again.",
              );
            }
            if (existing.startedAt !== review.startedAt) {
              throw new RequestError(409, "Review startedAt cannot change after the first save.");
            }
          }
          review.decisions.sort(
            (left, right) =>
              batch.batch.answerIds.indexOf(left.answerId) -
              batch.batch.answerIds.indexOf(right.answerId),
          );
          await reviewWriter(reviewsDir, review);
          return {
            etag: reviewEtag(review),
            body: {
              saved: true,
              reviewerId: review.reviewer.id,
              decisionCount: review.decisions.length,
              updatedAt: review.updatedAt,
            },
          };
        }, reviewLockOptions);
        sendJson(response, 200, saveResult.body, { ETag: saveResult.etag });
        return;
      }

      if (
        request.method === "GET" &&
        requestUrl.pathname === "/api/editorial/reconciliation"
      ) {
        if (requestUrl.search !== "") {
          throw new RequestError(400, "Reconciliation endpoint accepts no query parameters.");
        }
        const batch = await readEditorialBatch(batchPath);
        const reviews = await loadEditorialReviews(reviewsDir, batch);
        const reconciliation = buildReconciliation(batch, reviews, now());
        const outcomesMayBeDisclosed =
          reconciliation.reviewers.length >= 2 &&
          reconciliation.reviewers.every(({ complete }) => complete);
        sendJson(response, 200, {
          schemaVersion: 1,
          kind: "fjale-editorial-reconciliation-summary",
          batch: reconciliation.batch,
          generatedAt: reconciliation.generatedAt,
          reviewers: reconciliation.reviewers.map(({ decided, total, complete }) => ({
            decided,
            total,
            complete,
          })),
          summary: outcomesMayBeDisclosed
            ? reconciliation.summary
            : {
                total: reconciliation.summary.total,
                incomplete: reconciliation.summary.incomplete,
              },
        });
        return;
      }

      if (
        ["/api/editorial/batch", "/api/editorial/review", "/api/editorial/reconciliation"].includes(
          requestUrl.pathname,
        )
      ) {
        throw new RequestError(405, "Method not allowed.");
      }
      throw new RequestError(404, "Not found.");
    } catch (error) {
      if (error instanceof RequestError) {
        sendJson(response, error.statusCode, { error: error.message });
        return;
      }
      console.error(error);
      sendJson(response, 500, { error: "Editorial server error." });
    }
  };
}

export function createEditorialServer(options = {}) {
  return createServer(createEditorialRequestHandler(options));
}

function parsePort(value) {
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("EDITORIAL_PORT must be an integer from 1 to 65535.");
  }
  return port;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const port = parsePort(process.env.EDITORIAL_PORT ?? DEFAULT_EDITORIAL_PORT);
  const server = createEditorialServer();
  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.error(
        `Port ${port} is already in use. Choose another with ` +
          `EDITORIAL_PORT=4318 npm run editorial.`,
      );
    } else {
      console.error(error);
    }
    process.exitCode = 1;
  });
  server.listen(port, EDITORIAL_HOST, () => {
    console.log(`FJALË editorial editor: http://${EDITORIAL_HOST}:${port}/admin`);
    console.log("Local-only: review files are saved under editorial/reviews/.");
  });
}
