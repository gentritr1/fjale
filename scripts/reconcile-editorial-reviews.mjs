import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_EDITORIAL_BATCH_PATH,
  EDITORIAL_BATCH_ID,
  sha256,
} from "./build-editorial-batch.mjs";
import {
  buildReconciliation,
  loadEditorialReviews,
  readEditorialBatch,
  validateReviewDocument,
} from "./editorial-server.mjs";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_EDITORIAL_REVIEWS_DIR = resolve(
  REPOSITORY_ROOT,
  "editorial",
  "reviews",
  EDITORIAL_BATCH_ID,
);
export const DEFAULT_EDITORIAL_DECISIONS_PATH = resolve(
  REPOSITORY_ROOT,
  "editorial",
  "decisions",
  `${EDITORIAL_BATCH_ID}.json`,
);

async function atomicWriteJson(pathname, value) {
  await mkdir(dirname(pathname), { recursive: true });
  const temporaryPath = `${pathname}.${process.pid}.${Date.now()}.tmp`;

  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporaryPath, pathname);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

function validateReviewerSelection(reviewerIds) {
  if (reviewerIds === undefined) return null;
  if (!Array.isArray(reviewerIds) || reviewerIds.length < 2) {
    throw new Error("Choose at least two independent reviewer IDs for reconciliation.");
  }

  const normalized = reviewerIds.map((reviewerId) => String(reviewerId).trim().toLowerCase());
  for (const reviewerId of normalized) {
    if (!/^[a-z0-9][a-z0-9_-]{1,31}$/u.test(reviewerId)) {
      throw new Error(`Invalid reviewer ID in reconciliation selection: ${reviewerId || "(empty)"}.`);
    }
  }
  if (new Set(normalized).size !== normalized.length) {
    throw new Error("Reviewer IDs for reconciliation must be unique.");
  }
  return normalized;
}

async function loadSelectedReviews(reviewsDir, batch, reviewerIds) {
  const reviews = [];
  for (const reviewerId of reviewerIds) {
    const pathname = resolve(reviewsDir, `reviewer-${reviewerId}.json`);
    let source;
    try {
      source = await readFile(pathname, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") {
        throw new Error(`No review file exists for selected reviewer ${reviewerId}.`);
      }
      throw error;
    }
    reviews.push(validateReviewDocument(JSON.parse(source), batch, reviewerId));
  }
  return reviews;
}

export async function reconcileEditorialReviews({
  batchPath = DEFAULT_EDITORIAL_BATCH_PATH,
  reviewsDir = DEFAULT_EDITORIAL_REVIEWS_DIR,
  decisionsPath = DEFAULT_EDITORIAL_DECISIONS_PATH,
  generatedAt = new Date().toISOString(),
  reviewerIds,
} = {}) {
  const batch = await readEditorialBatch(batchPath);
  const selectedReviewerIds = validateReviewerSelection(reviewerIds);
  const reviews = selectedReviewerIds
    ? await loadSelectedReviews(reviewsDir, batch, selectedReviewerIds)
    : await loadEditorialReviews(reviewsDir, batch);

  if (reviews.length < 2) {
    throw new Error(
      `Reconciliation requires at least two independent review files; found ${reviews.length}.`,
    );
  }

  const incompleteReviewers = reviews
    .filter(({ decisions }) => decisions.length !== batch.entries.length)
    .map(
      ({ reviewer, decisions }) =>
        `${reviewer.id} (${decisions.length}/${batch.entries.length})`,
    );
  if (incompleteReviewers.length > 0) {
    throw new Error(
      `Every reviewer must cover the complete frozen batch before reconciliation: ` +
        incompleteReviewers.join(", "),
    );
  }

  const reconciliation = buildReconciliation(batch, reviews, generatedAt);
  const reviewMaps = new Map(
    reviews.map((review) => [
      review.reviewer.id,
      new Map(review.decisions.map((decision) => [decision.answerId, decision])),
    ]),
  );
  const decisions = reconciliation.entries.map((entry) => {
    const decision = {
      answerId: entry.answerId,
      sourceSha256: entry.sourceSha256,
      outcome: entry.state,
      reviews: entry.decisions,
    };

    if (entry.state === "approve_daily") {
      let approvedEntry = null;
      for (const { reviewerId } of entry.decisions) {
        const proposedEntry = reviewMaps.get(reviewerId).get(entry.answerId).proposedEntry;
        if (proposedEntry !== null && sha256(proposedEntry) === entry.approvedEntrySha256) {
          approvedEntry = proposedEntry;
          break;
        }
      }
      if (approvedEntry === null) {
        throw new Error(`Approved answer ${entry.answerId} has no matching proposed entry.`);
      }
      decision.approvedEntrySha256 = entry.approvedEntrySha256;
      decision.approvedEntry = approvedEntry;
    }

    return decision;
  });
  const output = {
    schemaVersion: 1,
    kind: "fjale-editorial-decisions",
    batch: structuredClone(batch.batch),
    generatedAt,
    reviewers: reviews.map(({ reviewer }) => reviewer.id).sort(),
    summary: reconciliation.summary,
    decisions,
  };

  await atomicWriteJson(decisionsPath, output);
  return { decisionsPath, output };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  try {
    const reviewerIds = process.argv.slice(2);
    if (reviewerIds.length < 2) {
      throw new Error(
        "Usage: npm run editorial:reconcile -- <reviewer-id-1> <reviewer-id-2> [reviewer-id-3 ...]",
      );
    }
    const { decisionsPath, output } = await reconcileEditorialReviews({ reviewerIds });
    console.log(`Wrote ${decisionsPath}.`);
    console.log(
      `Approved: ${output.summary.approved}; practice-only: ${output.summary.practiceOnly}; ` +
        `rejected: ${output.summary.rejected}; needs revision: ${output.summary.needsRevision}; ` +
        `conflicts: ${output.summary.conflict}; incomplete: ${output.summary.incomplete}.`,
    );
    if (output.summary.conflict > 0) {
      console.log("Conflict entries require a human reconciliation decision.");
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
