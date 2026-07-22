import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import {
  DEFAULT_EDITORIAL_BATCH_PATH,
  buildEditorialBatch,
  sha256,
  writeFrozenEditorialBatch,
} from "../scripts/build-editorial-batch.mjs";
import {
  atomicWriteReview,
  createEditorialRequestHandler,
  createEmptyReview,
  readEditorialBatch,
  withReviewFileLock,
} from "../scripts/editorial-server.mjs";
import {
  isSingleReviewerException,
  reconcileEditorialReviews,
} from "../scripts/reconcile-editorial-reviews.mjs";
import {
  claimReviewTabId,
  readReviewBackup,
  readReviewBackupCandidates,
  rebaseDirtyReviewRecords,
  restoreReviewBackupRecords,
  shouldApplyIncomingReviewRecord,
  threeWayMergeReviewRecords,
  writeReviewBackup,
} from "../editor/review-merge.js";

const FIXED_TIME = "2026-07-20T12:00:00.000Z";

function createDecision(source, overrides = {}) {
  return {
    answerId: source.answerId,
    sourceSha256: source.sourceSha256,
    verdict: "approve_daily",
    proposedEntry: structuredClone(source.entry),
    reason: "",
    notes: "",
    reviewedAt: FIXED_TIME,
    ...overrides,
  };
}

function createCompleteReview(batch, reviewerId) {
  return {
    ...createEmptyReview(batch, reviewerId, FIXED_TIME),
    decisions: batch.entries.map((source) => createDecision(source)),
  };
}

function createHandler(options = {}) {
  return createEditorialRequestHandler({ now: () => FIXED_TIME, ...options });
}

async function request(handler, pathname, { method = "GET", json, headers = {} } = {}) {
  const body = json === undefined ? "" : JSON.stringify(json);
  const incoming = Readable.from(body === "" ? [] : [Buffer.from(body)]);
  incoming.method = method;
  incoming.url = pathname;
  incoming.headers = {
    host: "127.0.0.1:4317",
    ...(json === undefined
      ? {}
      : { "content-type": "application/json", "content-length": String(Buffer.byteLength(body)) }),
    ...headers,
  };
  const result = { status: undefined, headers: undefined, body: Buffer.alloc(0) };
  const response = {
    writeHead(status, responseHeaders) {
      result.status = status;
      result.headers = responseHeaders;
    },
    end(responseBody = "") {
      result.body = Buffer.isBuffer(responseBody)
        ? responseBody
        : Buffer.from(String(responseBody));
    },
  };
  await handler(incoming, response);
  result.text = () => result.body.toString("utf8");
  result.json = () => JSON.parse(result.text());
  return result;
}

test("pins the frozen batch hashes and immutable word identities", async () => {
  const generated = buildEditorialBatch();
  const frozen = JSON.parse(await readFile(DEFAULT_EDITORIAL_BATCH_PATH, "utf8"));

  assert.equal(frozen.entries.length, 76);
  assert.deepEqual(frozen.batch.answerIds, Array.from({ length: 76 }, (_, index) => index + 62));
  assert.deepEqual(
    frozen.entries.map(({ answerId, entry }) => ({ answerId, word: entry.word })),
    generated.entries.map(({ answerId, entry }) => ({ answerId, word: entry.word })),
  );
  assert.equal(frozen.batch.sourceCatalogSha256, sha256(frozen.entries));
  for (const source of frozen.entries) {
    assert.equal(source.sourceSha256, sha256(source.entry));
    assert.equal(source.answerId, source.entry.id);
  }
});

test("ignores private editorial outputs without hiding the frozen batch", async () => {
  const gitignore = await readFile(".gitignore", "utf8");
  const patterns = new Set(
    gitignore
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#")),
  );

  for (const privateOutput of [
    "editorial/reviews/",
    "editorial/decisions/",
    "editorial/epoch-proposals/",
    "editorial/backups/",
  ]) {
    assert.ok(patterns.has(privateOutput), `.gitignore must exclude ${privateOutput}`);
  }
  assert.equal(patterns.has("editorial/"), false);
  assert.equal(patterns.has("editorial/batches/"), false);
});

test("never overwrites a changed frozen batch", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "fjale-batch-test-"));
  const pathname = resolve(directory, "batch.json");
  await writeFrozenEditorialBatch(pathname);
  const changed = buildEditorialBatch();
  changed.entries[0].entry.clue = "Ndryshim që nuk duhet të mbishkruhet.";

  await assert.rejects(
    writeFrozenEditorialBatch(pathname, changed),
    /Refusing to overwrite frozen editorial batch/u,
  );
});

test("serves only the local admin allowlist with a strict CSP", async () => {
  const handler = createHandler();
  const admin = await request(handler, "/admin");

  assert.equal(admin.status, 200);
  assert.match(admin.headers["Content-Security-Policy"], /default-src 'none'/u);
  assert.match(admin.headers["Content-Security-Policy"], /connect-src 'self'/u);
  assert.equal((await request(handler, "/src/words.js")).status, 404);
  assert.equal((await request(handler, "/admin/review-merge.js")).status, 200);
  assert.equal((await request(handler, "/admin/..%2Fsrc%2Fwords.js")).status, 404);
  assert.equal((await request(handler, "/api/editorial/batch", { method: "POST" })).status, 405);
});

test("keeps the local editor DOM, assets, and accessibility contracts wired", async () => {
  const [html, styles, client] = await Promise.all([
    readFile("editor/index.html", "utf8"),
    readFile("editor/editor.css", "utf8"),
    readFile("editor/editor.js", "utf8"),
  ]);

  assert.match(html, /<html lang="sq">/u);
  assert.match(html, /name="robots" content="noindex, nofollow, noarchive"/u);
  assert.ok(html.includes('href="/admin/editor.css"'));
  assert.ok(html.includes('src="/admin/editor.js"'));
  assert.doesNotMatch(html, /https?:\/\//u, "the local editor must load no external resource");
  assert.match(styles, /prefers-reduced-motion: reduce/u);
  assert.match(styles, /prefers-color-scheme: dark/u);
  assert.ok(client.includes('method: "POST"'));
  assert.ok(client.includes("const METADATA_FIELDS = EDITABLE_FIELDS"));
  assert.ok(client.includes('kind: "fjale-editorial-backup"'));
  assert.ok(client.includes("function isReviewComplete(record)"));
  assert.ok(client.includes("conflictedAnswerIds"));
  assert.ok(client.includes("payload.baseRecords"));
  assert.ok(client.includes("payload.dirtyAnswerIds"));
  assert.ok(client.includes("restoreLocalReviewFromMergeBase"));
  assert.ok(client.includes('from "/admin/review-merge.js"'));
  assert.doesNotMatch(html, /id="edit-word"/u);
  assert.match(html, /id="use-disk-button"/u);
  assert.match(html, /id="keep-local-button"/u);
  assert.match(html, /aria-label="Zhbëj vendimin e fundit"/u);

  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/gu)].map((match) => match[1]));
  for (const [, id] of client.matchAll(/querySelector\("#([^"]+)"\)/gu)) {
    assert.ok(ids.has(id), `editor client expects missing #${id}`);
  }
});

test("three-way review merge preserves server deletions and surfaces same-record conflicts", () => {
  const record = (answerId, clue) => ({ answerId, proposedEntry: { clue } });
  const base = new Map([[62, record(62, "Miratimi i vjetër")]]);
  const latestAfterDeletion = new Map();
  const localWithUnrelatedEdit = new Map([
    [62, record(62, "Miratimi i vjetër")],
    [63, record(63, "Ndryshim lokal")],
  ]);
  const deletionMerge = threeWayMergeReviewRecords({
    baseRecords: base,
    latestRecords: latestAfterDeletion,
    localRecords: localWithUnrelatedEdit,
    dirtyAnswerIds: new Set([63]),
  });
  assert.deepEqual([...deletionMerge.records.keys()], [63]);
  assert.deepEqual(deletionMerge.conflictIds, []);

  const sameBase = new Map([[63, record(63, "Baza")]]);
  const sameLatest = new Map([[63, record(63, "Skeda A")]]);
  const sameLocal = new Map([[63, record(63, "Skeda B")]]);
  const conflictMerge = threeWayMergeReviewRecords({
    baseRecords: sameBase,
    latestRecords: sameLatest,
    localRecords: sameLocal,
    dirtyAnswerIds: new Set([63]),
  });
  assert.deepEqual(conflictMerge.conflictIds, [63]);
  assert.equal(conflictMerge.records.get(63).proposedEntry.clue, "Skeda B");
});

test("restores the local half of a persisted conflict even when it is older than disk", () => {
  const diskRecord = {
    answerId: 62,
    updatedAt: "2026-07-20T12:05:00.000Z",
    proposedEntry: { clue: "Versioni në disk" },
  };
  const localRecord = {
    answerId: 62,
    updatedAt: "2026-07-20T12:00:00.000Z",
    proposedEntry: { clue: "Versioni lokal" },
  };

  assert.equal(
    shouldApplyIncomingReviewRecord({
      currentRecord: diskRecord,
      incomingRecord: localRecord,
      onlyNewer: true,
      preferIncomingOnTie: true,
    }),
    false,
    "an ordinary older local snapshot must not replace newer disk state",
  );
  assert.equal(
    shouldApplyIncomingReviewRecord({
      currentRecord: diskRecord,
      incomingRecord: localRecord,
      onlyNewer: true,
      preferIncomingOnTie: true,
      forceIncoming: true,
    }),
    true,
    "an unresolved conflict must restore its exact local half for explicit resolution",
  );
  assert.equal(
    shouldApplyIncomingReviewRecord({
      currentRecord: diskRecord,
      incomingRecord: { ...localRecord, updatedAt: diskRecord.updatedAt },
      onlyNewer: true,
      preferIncomingOnTie: true,
    }),
    true,
  );
  assert.equal(
    shouldApplyIncomingReviewRecord({
      currentRecord: undefined,
      incomingRecord: localRecord,
      onlyNewer: true,
    }),
    true,
  );
});

test("rebases edits made while 409 recovery fetches the latest disk review", () => {
  const record = (answerId, clue, updatedAt = FIXED_TIME) => ({
    answerId,
    updatedAt,
    proposedEntry: { clue },
  });
  const baseRecords = new Map([[62, record(62, "Baza")]]);
  const latestRecords = new Map([
    [62, record(62, "Ndryshimi në disk", "2026-07-20T12:01:00.000Z")],
    [64, record(64, "Shtuar në disk", "2026-07-20T12:01:00.000Z")],
  ]);

  // This map represents live state after the fetch has started: answer 62 was
  // edited again and an incomplete local-only draft was added at answer 63.
  const currentRecords = new Map([
    [62, record(62, "Shkruar gjatë kërkesës", "2026-07-20T12:02:00.000Z")],
    [63, { answerId: 63, updatedAt: "2026-07-20T12:02:00.000Z", proposedEntry: {} }],
  ]);
  const result = rebaseDirtyReviewRecords({
    baseRecords,
    latestRecords,
    currentRecords,
    dirtyAnswerIds: new Set([62, 63]),
  });

  assert.equal(result.records.get(62).proposedEntry.clue, "Shkruar gjatë kërkesës");
  assert.deepEqual(result.records.get(63).proposedEntry, {}, "invalid drafts remain local");
  assert.equal(result.records.get(64).proposedEntry.clue, "Shtuar në disk");
  assert.deepEqual(result.conflictIds, [62]);
});

test("reloads an old-base local edit as an explicit conflict without losing either variant", () => {
  const record = (answerId, clue, updatedAt) => ({
    answerId,
    updatedAt,
    proposedEntry: { clue },
  });
  const baseRecords = new Map([
    [62, record(62, "Baza", "2026-07-20T12:00:00.000Z")],
  ]);
  const latestRecords = new Map([
    [62, record(62, "Versioni më i ri në disk", "2026-07-20T12:05:00.000Z")],
    [64, record(64, "Shtuar në disk", "2026-07-20T12:05:00.000Z")],
  ]);
  const localRecords = new Map([
    [62, record(62, "Versioni lokal i saktë", "2026-07-20T12:01:00.000Z")],
  ]);

  const restored = restoreReviewBackupRecords({
    baseRecords,
    latestRecords,
    localRecords,
    dirtyAnswerIds: new Set([62]),
  });

  assert.deepEqual(restored.conflictIds, [62]);
  assert.deepEqual(restored.records.get(62), localRecords.get(62));
  assert.equal(restored.records.get(64).proposedEntry.clue, "Shtuar në disk");
  assert.equal(latestRecords.get(62).proposedEntry.clue, "Versioni më i ri në disk");
});

test("reload three-way merge combines unrelated local and disk changes", () => {
  const record = (answerId, clue) => ({ answerId, proposedEntry: { clue } });
  const baseRecords = new Map([
    [62, record(62, "Baza 62")],
    [63, record(63, "Baza 63")],
  ]);
  const latestRecords = new Map([
    [62, record(62, "Ndryshuar në disk")],
    [63, record(63, "Baza 63")],
    [64, record(64, "Shtuar në disk")],
  ]);
  const localRecords = new Map([
    [62, record(62, "Baza 62")],
    [63, { answerId: 63, proposedEntry: { clue: "Skicë lokale e paplotë" } }],
  ]);

  const restored = restoreReviewBackupRecords({
    baseRecords,
    latestRecords,
    localRecords,
    dirtyAnswerIds: new Set([63]),
  });

  assert.deepEqual(restored.conflictIds, []);
  assert.equal(restored.records.get(62).proposedEntry.clue, "Ndryshuar në disk");
  assert.deepEqual(restored.records.get(63), localRecords.get(63));
  assert.equal(restored.records.get(64).proposedEntry.clue, "Shtuar në disk");
});

test("keeps each tab's local-only review backup after another tab replaces the shared copy", () => {
  const values = new Map();
  const storage = {
    get length() {
      return values.size;
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
  const sharedKey = "fjale-editorial-review-v1:batch:reviewer";
  const tabBReview = JSON.stringify({
    localRecords: [{ answerId: 62, proposedEntry: { clue: "Skica lokale e B" } }],
    conflictedAnswerIds: [62],
  });
  const tabAReview = JSON.stringify({
    localRecords: [{ answerId: 63, proposedEntry: { clue: "Ndryshimi i A" } }],
    conflictedAnswerIds: [],
  });

  writeReviewBackup(storage, sharedKey, "tab-b", tabBReview);
  writeReviewBackup(storage, sharedKey, "tab-a", tabAReview);

  assert.equal(values.get(sharedKey), tabAReview, "tab A replaces only the shared fallback");
  assert.equal(
    readReviewBackup(storage, sharedKey, "tab-b"),
    tabBReview,
    "tab B reloads its conflict/local-only draft from its own snapshot",
  );
  assert.equal(readReviewBackup(storage, sharedKey, "new-tab"), tabAReview);
  assert.deepEqual(
    readReviewBackupCandidates(storage, sharedKey, "new-tab").map(({ key }) => key),
    [`${sharedKey}:tab:tab-a`, `${sharedKey}:tab:tab-b`],
    "a new tab can discover orphaned tab-owned snapshots after the shared copy changes",
  );
});

test("gives a duplicated editor tab its own backup identity while reload keeps the old one", async () => {
  class FakeBroadcastChannel {
    static channels = new Map();

    constructor(name) {
      this.name = name;
      this.listeners = new Set();
      const peers = FakeBroadcastChannel.channels.get(name) ?? new Set();
      peers.add(this);
      FakeBroadcastChannel.channels.set(name, peers);
    }

    addEventListener(type, listener) {
      if (type === "message") this.listeners.add(listener);
    }

    removeEventListener(type, listener) {
      if (type === "message") this.listeners.delete(listener);
    }

    postMessage(data) {
      for (const peer of FakeBroadcastChannel.channels.get(this.name) ?? []) {
        if (peer === this) continue;
        queueMicrotask(() => {
          for (const listener of peer.listeners) listener({ data });
        });
      }
    }

    close() {
      FakeBroadcastChannel.channels.get(this.name)?.delete(this);
    }
  }

  const storage = (initialValue) => {
    const values = new Map(initialValue ? [["tab-id", initialValue]] : []);
    return {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    };
  };
  let nextId = 0;
  const createId = () => `generated-${++nextId}`;
  const firstStorage = storage("copied-session-id");
  const first = await claimReviewTabId({
    storage: firstStorage,
    storageKey: "tab-id",
    createId,
    BroadcastChannelClass: FakeBroadcastChannel,
    channelName: "test-editor-tabs",
    navigationType: "reload",
    probeWaitMs: 1,
  });
  assert.equal(first.tabId, "copied-session-id");

  const duplicateStorage = storage("copied-session-id");
  const duplicate = await claimReviewTabId({
    storage: duplicateStorage,
    storageKey: "tab-id",
    createId,
    BroadcastChannelClass: FakeBroadcastChannel,
    channelName: "test-editor-tabs",
    navigationType: "navigate",
    probeWaitMs: 1,
  });
  assert.notEqual(duplicate.tabId, first.tabId);

  const restoredCollision = await claimReviewTabId({
    storage: storage("copied-session-id"),
    storageKey: "tab-id",
    createId,
    BroadcastChannelClass: FakeBroadcastChannel,
    channelName: "test-editor-tabs",
    navigationType: "reload",
    probeWaitMs: 1,
  });
  assert.notEqual(
    restoredCollision.tabId,
    first.tabId,
    "the channel also separates an unusual reload/session-restore collision",
  );

  class DelayedBroadcastChannel extends FakeBroadcastChannel {
    postMessage(data) {
      setTimeout(() => super.postMessage(data), 25);
    }
  }
  const delayedDuplicate = await claimReviewTabId({
    storage: storage("copied-session-id"),
    storageKey: "tab-id",
    createId,
    BroadcastChannelClass: DelayedBroadcastChannel,
    channelName: "test-editor-tabs",
    navigationType: "navigate",
    probeWaitMs: 1,
  });
  assert.notEqual(
    delayedDuplicate.tabId,
    first.tabId,
    "a duplicated navigation rotates before a throttled original tab can answer",
  );
  first.close();
  duplicate.close();
  restoredCollision.close();
  delayedDuplicate.close();

  const fallbackReload = await claimReviewTabId({
    storage: storage("reload-id"),
    storageKey: "tab-id",
    createId,
    BroadcastChannelClass: undefined,
    channelName: "unused",
    navigationType: "reload",
  });
  assert.equal(fallbackReload.tabId, "reload-id");

  const fallbackDuplicate = await claimReviewTabId({
    storage: storage("duplicate-id"),
    storageKey: "tab-id",
    createId,
    BroadcastChannelClass: undefined,
    channelName: "unused",
    navigationType: "navigate",
  });
  assert.notEqual(fallbackDuplicate.tabId, "duplicate-id");

  class ThrowingBroadcastChannel {
    constructor() {
      throw new DOMException("blocked", "SecurityError");
    }
  }
  const blockedChannel = await claimReviewTabId({
    storage: storage("blocked-channel-id"),
    storageKey: "tab-id",
    createId,
    BroadcastChannelClass: ThrowingBroadcastChannel,
    channelName: "blocked",
    navigationType: "reload",
  });
  assert.equal(blockedChannel.tabId, "blocked-channel-id");

  let failedChannelClosed = false;
  class ThrowingPostChannel {
    addEventListener() {}
    removeEventListener() {}
    postMessage() {
      throw new DOMException("blocked", "SecurityError");
    }
    close() {
      failedChannelClosed = true;
    }
  }
  const failedPost = await claimReviewTabId({
    storage: null,
    storageKey: "tab-id",
    createId,
    BroadcastChannelClass: ThrowingPostChannel,
    channelName: "blocked-post",
    navigationType: "navigate",
  });
  assert.match(failedPost.tabId, /^generated-/u);
  assert.equal(failedChannelClosed, true);

  class FakeLockManager {
    constructor() {
      this.heldNames = new Set();
    }

    request(name, options, callback) {
      assert.deepEqual(options, { mode: "exclusive", ifAvailable: true });
      if (this.heldNames.has(name)) return Promise.resolve(callback(null));
      this.heldNames.add(name);
      return Promise.resolve(callback({ name })).finally(() => {
        this.heldNames.delete(name);
      });
    }
  }
  const lockManager = new FakeLockManager();
  const lockedOriginal = await claimReviewTabId({
    storage: storage("history-copy-id"),
    storageKey: "tab-id",
    createId,
    lockManager,
    BroadcastChannelClass: undefined,
    channelName: "unused",
    navigationType: "back_forward",
  });
  const lockedDuplicate = await claimReviewTabId({
    storage: storage("history-copy-id"),
    storageKey: "tab-id",
    createId,
    lockManager,
    BroadcastChannelClass: undefined,
    channelName: "unused",
    navigationType: "back_forward",
  });
  assert.notEqual(
    lockedDuplicate.tabId,
    lockedOriginal.tabId,
    "a held browser lock separates a duplicated tab even when it reports back_forward",
  );
  lockedOriginal.close();
  lockedDuplicate.close();
});

test("autosaves partial decisions and metadata drafts in separate reviewer files", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "fjale-editor-test-"));
  const reviewsDir = resolve(directory, "reviews");
  const batch = await readEditorialBatch();
  const handler = createHandler({ reviewsDir });
  const emptyResponse = await request(handler, "/api/editorial/review?reviewer=arta-k");
  assert.equal(emptyResponse.status, 404);
  const review = createEmptyReview(batch, "arta-k", FIXED_TIME);
  const source = batch.entries[0];

  assert.deepEqual(review.drafts, []);
  review.decisions = [createDecision(source)];
  review.drafts = [
    {
      answerId: batch.entries[1].answerId,
      sourceSha256: batch.entries[1].sourceSha256,
      proposedEntry: {
        ...structuredClone(batch.entries[1].entry),
        clue: "Një gjurmë e ruajtur para vendimit.",
      },
      notes: "Duhet kontrolluar përkufizimi.",
      updatedAt: FIXED_TIME,
    },
  ];
  review.updatedAt = FIXED_TIME;

  const save = await request(handler, "/api/editorial/review", {
    method: "POST",
    json: review,
    headers: { "if-none-match": "*" },
  });
  assert.equal(save.status, 200, save.text());
  assert.match(save.headers.ETag, /^"sha256-[a-f0-9]{64}"$/u);
  const restoredResponse = await request(handler, "/api/editorial/review?reviewer=arta-k");
  const restored = restoredResponse.json();
  assert.deepEqual(restored, review);
  assert.equal(restoredResponse.headers.ETag, save.headers.ETag);

  const other = createEmptyReview(batch, "besa-2", FIXED_TIME);
  const otherSave = await request(handler, "/api/editorial/review", {
    method: "POST",
    json: other,
    headers: { "if-none-match": "*" },
  });
  assert.equal(otherSave.status, 200);
  assert.deepEqual((await readdir(reviewsDir)).sort(), [
    "reviewer-arta-k.json",
    "reviewer-besa-2.json",
  ]);
  assert.equal((await readdir(reviewsDir)).some((name) => name.endsWith(".tmp")), false);
});

test("rejects stale full-snapshot saves from another tab", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "fjale-concurrency-test-"));
  const batch = await readEditorialBatch();
  const handler = createHandler({ reviewsDir: resolve(directory, "reviews") });
  const base = createEmptyReview(batch, "same-reviewer", FIXED_TIME);
  const created = await request(handler, "/api/editorial/review", {
    method: "POST",
    json: base,
    headers: { "if-none-match": "*" },
  });
  assert.equal(created.status, 200, created.text());

  const firstTab = structuredClone(base);
  firstTab.decisions = [createDecision(batch.entries[0])];
  const secondTab = structuredClone(base);
  secondTab.decisions = [createDecision(batch.entries[1])];
  const firstSave = await request(handler, "/api/editorial/review", {
    method: "POST",
    json: firstTab,
    headers: { "if-match": created.headers.ETag },
  });
  assert.equal(firstSave.status, 200, firstSave.text());
  const staleSave = await request(handler, "/api/editorial/review", {
    method: "POST",
    json: secondTab,
    headers: { "if-match": created.headers.ETag },
  });
  assert.equal(staleSave.status, 409, staleSave.text());
  assert.match(staleSave.text(), /another tab/u);

  const restored = (
    await request(handler, "/api/editorial/review?reviewer=same-reviewer")
  ).json();
  assert.deepEqual(restored.decisions.map(({ answerId }) => answerId), [62]);
});

test("makes ETag compare-and-write atomic across independent server handlers", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "fjale-process-concurrency-test-"));
  const reviewsDir = resolve(directory, "reviews");
  const batch = await readEditorialBatch();
  const base = createEmptyReview(batch, "process-reviewer", FIXED_TIME);
  const creator = createHandler({ reviewsDir });
  const created = await request(creator, "/api/editorial/review", {
    method: "POST",
    json: base,
    headers: { "if-none-match": "*" },
  });
  assert.equal(created.status, 200, created.text());

  let markWriterEntered;
  const writerEntered = new Promise((resolveEntered) => {
    markWriterEntered = resolveEntered;
  });
  let allowWriter;
  const writerGate = new Promise((resolveWriter) => {
    allowWriter = resolveWriter;
  });
  const firstHandler = createHandler({
    reviewsDir,
    reviewWriter: async (...arguments_) => {
      markWriterEntered();
      await writerGate;
      return atomicWriteReview(...arguments_);
    },
  });
  const secondHandler = createHandler({ reviewsDir });
  const firstTab = structuredClone(base);
  firstTab.decisions = [createDecision(batch.entries[0])];
  const secondTab = structuredClone(base);
  secondTab.decisions = [createDecision(batch.entries[1])];

  const firstSavePromise = request(firstHandler, "/api/editorial/review", {
    method: "POST",
    json: firstTab,
    headers: { "if-match": created.headers.ETag },
  });
  await writerEntered;
  let secondSettled = false;
  const secondSavePromise = request(secondHandler, "/api/editorial/review", {
    method: "POST",
    json: secondTab,
    headers: { "if-match": created.headers.ETag },
  }).finally(() => {
    secondSettled = true;
  });

  try {
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    assert.equal(
      secondSettled,
      false,
      "the second handler must wait while the first holds the filesystem lock",
    );
  } finally {
    allowWriter();
  }

  const [firstSave, secondSave] = await Promise.all([
    firstSavePromise,
    secondSavePromise,
  ]);
  assert.equal(firstSave.status, 200, firstSave.text());
  assert.equal(secondSave.status, 409, secondSave.text());
  assert.match(secondSave.text(), /another tab/u);

  const restored = (
    await request(creator, "/api/editorial/review?reviewer=process-reviewer")
  ).json();
  assert.deepEqual(restored.decisions.map(({ answerId }) => answerId), [62]);
  assert.equal((await readdir(reviewsDir)).some((name) => name.includes(".lock")), false);
});

test("bounds lock waits, cleans released locks, and reclaims a crashed process lock", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "fjale-lock-lifecycle-test-"));
  const reviewsDir = resolve(directory, "reviews");
  const batch = await readEditorialBatch();
  const review = createEmptyReview(batch, "lock-reviewer", FIXED_TIME);

  let markLockHeld;
  const lockHeld = new Promise((resolveHeld) => {
    markLockHeld = resolveHeld;
  });
  let releaseOperation;
  const operationGate = new Promise((resolveOperation) => {
    releaseOperation = resolveOperation;
  });
  const heldOperation = withReviewFileLock(
    reviewsDir,
    "lock-reviewer",
    async () => {
      markLockHeld();
      await operationGate;
    },
    { acquireTimeoutMs: 500, retryMs: 5, staleMs: 60 },
  );
  await lockHeld;
  await new Promise((resolveWait) => setTimeout(resolveWait, 180));

  const startedAt = performance.now();
  const busyResponse = await request(
    createHandler({
      reviewsDir,
      reviewLockOptions: { acquireTimeoutMs: 40, retryMs: 5, staleMs: 60 },
    }),
    "/api/editorial/review",
    { method: "POST", json: review, headers: { "if-none-match": "*" } },
  );
  const elapsedMs = performance.now() - startedAt;
  assert.equal(busyResponse.status, 503, busyResponse.text());
  assert.match(busyResponse.text(), /another process/u);
  assert.ok(elapsedMs < 1_000, `lock wait was not bounded: ${elapsedMs}ms`);

  releaseOperation();
  await heldOperation;
  assert.equal((await readdir(reviewsDir)).some((name) => name.includes(".lock")), false);

  const deadOwner = spawn(process.execPath, ["-e", ""]);
  await once(deadOwner, "exit");
  const lockPath = resolve(reviewsDir, ".reviewer-lock-reviewer.lock");
  await mkdir(lockPath, { mode: 0o700 });
  await writeFile(
    resolve(lockPath, "owner.json"),
    `${JSON.stringify({
      token: "owner-from-crashed-process",
      pid: deadOwner.pid,
      createdAt: FIXED_TIME,
    })}\n`,
    { mode: 0o600 },
  );

  const recovered = await request(
    createHandler({
      reviewsDir,
      reviewLockOptions: { acquireTimeoutMs: 500, retryMs: 5, staleMs: 30_000 },
    }),
    "/api/editorial/review",
    { method: "POST", json: review, headers: { "if-none-match": "*" } },
  );
  assert.equal(recovered.status, 200, recovered.text());
  assert.deepEqual(await readdir(reviewsDir), ["reviewer-lock-reviewer.json"]);
});

test("reclaims missing, corrupt, and reused-PID stale lock artifacts", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "fjale-stale-lock-test-"));
  const reviewsDir = resolve(directory, "reviews");
  const batch = await readEditorialBatch();
  await mkdir(reviewsDir, { mode: 0o700 });
  const oldTimestamp = new Date(Date.now() - 60_000);
  const deadReaper = spawn(process.execPath, ["-e", ""]);
  await once(deadReaper, "exit");

  for (const [reviewerId, ownerSource] of [
    ["missing-owner", undefined],
    ["corrupt-owner", "not-json\n"],
    [
      "reused-pid",
      `${JSON.stringify({
        token: "owner-from-an-earlier-process-instance",
        pid: process.pid,
        createdAt: FIXED_TIME,
        completedAt: null,
      })}\n`,
    ],
  ]) {
    const lockPath = resolve(reviewsDir, `.reviewer-${reviewerId}.lock`);
    await mkdir(lockPath, { mode: 0o700 });
    if (ownerSource !== undefined) {
      await writeFile(resolve(lockPath, "owner.json"), ownerSource, { mode: 0o600 });
    } else {
      // Keep the ownerless directory non-empty so candidate installation
      // cannot replace it directly on platforms that replace empty folders.
      await writeFile(resolve(lockPath, "partial"), "incomplete\n", { mode: 0o600 });
    }
    await utimes(lockPath, oldTimestamp, oldTimestamp);

    if (reviewerId === "missing-owner") {
      const orphanedReaperPath = `${lockPath}.reaping-orphaned-process`;
      await writeFile(
        orphanedReaperPath,
        `${JSON.stringify({
          token: "orphaned-process",
          pid: deadReaper.pid,
          createdAt: FIXED_TIME,
        })}\n`,
        { mode: 0o600 },
      );
    } else if (reviewerId === "reused-pid") {
      const staleMarkerPath = `${lockPath}.reaping-reused-pid-marker`;
      await writeFile(
        staleMarkerPath,
        `${JSON.stringify({
          token: "reused-pid-marker",
          pid: process.pid,
          createdAt: FIXED_TIME,
          completedAt: null,
        })}\n`,
        { mode: 0o600 },
      );
      await utimes(staleMarkerPath, oldTimestamp, oldTimestamp);
    }

    const response = await request(
      createHandler({
        reviewsDir,
        reviewLockOptions: { acquireTimeoutMs: 500, retryMs: 5, staleMs: 100 },
      }),
      "/api/editorial/review",
      {
        method: "POST",
        json: createEmptyReview(batch, reviewerId, FIXED_TIME),
        headers: { "if-none-match": "*" },
      },
    );
    assert.equal(response.status, 200, `${reviewerId}: ${response.text()}`);
  }

  assert.deepEqual((await readdir(reviewsDir)).sort(), [
    "reviewer-corrupt-owner.json",
    "reviewer-missing-owner.json",
    "reviewer-reused-pid.json",
  ]);
});

test("rejects stale hashes, unsafe reviewer ids, invalid reasons, and extra fields", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "fjale-invalid-test-"));
  const batch = await readEditorialBatch();
  const handler = createHandler({ reviewsDir: resolve(directory, "reviews") });
  const source = batch.entries[0];
  const original = createEmptyReview(batch, "reviewer-1", FIXED_TIME);

  assert.equal(
    (await request(handler, "/api/editorial/review?reviewer=../escape")).status,
    400,
  );
  assert.equal(
    (await request(handler, "/api/editorial/review", { method: "POST", json: null })).status,
    400,
  );

  for (const mutate of [
    (review) => {
      review.unexpected = true;
    },
    (review) => {
      review.decisions = [createDecision(source, { sourceSha256: "0".repeat(64) })];
    },
    (review) => {
      review.decisions = [
        createDecision(source, { verdict: "practice_only", reason: "" }),
      ];
    },
    (review) => {
      review.drafts = [
        {
          answerId: source.answerId,
          sourceSha256: source.sourceSha256,
          proposedEntry: { ...source.entry, clue: "" },
          notes: "",
          updatedAt: FIXED_TIME,
        },
      ];
    },
    (review) => {
      review.drafts = [
        {
          answerId: source.answerId,
          sourceSha256: source.sourceSha256,
          proposedEntry: { ...source.entry, syllables: "ndar-je-e-ga-bu-ar" },
          notes: "",
          updatedAt: FIXED_TIME,
        },
      ];
    },
    (review) => {
      review.drafts = [
        {
          answerId: source.answerId,
          sourceSha256: source.sourceSha256,
          proposedEntry: { ...source.entry, region: "regional" },
          notes: "",
          updatedAt: FIXED_TIME,
        },
      ];
    },
    (review) => {
      review.drafts = [
        {
          answerId: source.answerId,
          sourceSha256: source.sourceSha256,
          proposedEntry: { ...source.entry, word: "balon" },
          notes: "Një ID ekzistuese nuk mund të riemërtohet.",
          updatedAt: FIXED_TIME,
        },
      ];
    },
  ]) {
    const review = structuredClone(original);
    mutate(review);
    const response = await request(handler, "/api/editorial/review", {
      method: "POST",
      json: review,
    });
    assert.ok([400, 409].includes(response.status), response.text());
  }

  const overlapping = structuredClone(original);
  overlapping.decisions = [createDecision(source)];
  overlapping.drafts = [
    {
      answerId: source.answerId,
      sourceSha256: source.sourceSha256,
      proposedEntry: structuredClone(source.entry),
      notes: "Nuk mund të jetë vendim dhe skicë njëkohësisht.",
      updatedAt: FIXED_TIME,
    },
  ];
  const overlapResponse = await request(handler, "/api/editorial/review", {
    method: "POST",
    json: overlapping,
  });
  assert.equal(overlapResponse.status, 400, overlapResponse.text());
  assert.match(overlapResponse.text(), /both decisions and drafts/u);
});

test("reconciliation preserves unanimous editorial outcomes and isolates conflicts", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "fjale-reconcile-test-"));
  const reviewsDir = resolve(directory, "reviews");
  const decisionsPath = resolve(directory, "decisions", "result.json");
  const batch = await readEditorialBatch();
  const first = createCompleteReview(batch, "reviewer-1");
  const incomplete = createEmptyReview(batch, "reviewer-2", FIXED_TIME);
  incomplete.decisions = [createDecision(batch.entries[0])];
  await atomicWriteReview(reviewsDir, first);
  await atomicWriteReview(reviewsDir, incomplete);

  const partialSummary = (
    await request(createHandler({ reviewsDir }), "/api/editorial/reconciliation")
  ).json();
  assert.equal(Object.hasOwn(partialSummary.summary, "approved"), false);
  assert.equal(Object.hasOwn(partialSummary.summary, "conflict"), false);

  await assert.rejects(
    reconcileEditorialReviews({ reviewsDir, decisionsPath, generatedAt: FIXED_TIME }),
    /reviewer-2 \(1\/76\)/u,
  );

  const second = createCompleteReview(batch, "reviewer-2");
  for (const review of [first, second]) {
    review.decisions[0].verdict = "practice_only";
    review.decisions[0].reason = "not_daily_suitable";
    review.decisions[1].verdict = "reject_content";
    review.decisions[1].reason =
      review.reviewer.id === "reviewer-1" ? "not_standard" : "ambiguous_content";
    review.decisions[1].proposedEntry = null;
    review.decisions[2].verdict = "needs_revision";
    review.decisions[2].reason = "definition_needs_revision";
  }
  second.decisions[2].proposedEntry.clue = "Ndryshim i papërfunduar që nuk bashkohet automatikisht.";
  first.decisions[3].verdict = "practice_only";
  first.decisions[3].reason = "not_daily_suitable";
  second.decisions[3].verdict = "reject_content";
  second.decisions[3].reason = "not_standard";
  second.decisions[3].proposedEntry = null;
  first.decisions[4].verdict = "practice_only";
  first.decisions[4].reason = "not_daily_suitable";
  second.decisions[4].verdict = "practice_only";
  second.decisions[4].reason = "not_daily_suitable";
  second.decisions[4].proposedEntry.clue = "Gjurmë tjetër për praktikë.";
  second.decisions[5].proposedEntry.clue = "Gjurmë tjetër, që kërkon bashkërendim.";
  await atomicWriteReview(reviewsDir, first);
  await atomicWriteReview(reviewsDir, second);
  const abandoned = createEmptyReview(batch, "abandoned-review", FIXED_TIME);
  abandoned.decisions = [createDecision(batch.entries[0])];
  await atomicWriteReview(reviewsDir, abandoned);

  await assert.rejects(
    reconcileEditorialReviews({ reviewsDir, decisionsPath, generatedAt: FIXED_TIME }),
    /abandoned-review \(1\/76\)/u,
  );
  const { output } = await reconcileEditorialReviews({
    reviewsDir,
    decisionsPath,
    generatedAt: FIXED_TIME,
    reviewerIds: ["reviewer-1", "reviewer-2"],
  });

  assert.equal(output.summary.approved, 70);
  assert.equal(output.summary.practiceOnly, 1);
  assert.equal(output.summary.rejected, 1);
  assert.equal(output.summary.needsRevision, 1);
  assert.equal(output.summary.conflict, 3);
  assert.equal(output.summary.incomplete, 0);
  assert.equal(output.summary.total, 76);
  assert.deepEqual(
    output.decisions.slice(0, 7).map(({ outcome }) => outcome),
    [
      "practice_only",
      "reject_content",
      "needs_revision",
      "conflict",
      "conflict",
      "conflict",
      "approve_daily",
    ],
  );
  for (const decision of output.decisions.slice(0, 6)) {
    assert.equal(Object.hasOwn(decision, "approvedEntry"), false);
    assert.equal(Object.hasOwn(decision, "approvedEntrySha256"), false);
  }
  assert.deepEqual(output.decisions[6].approvedEntry, batch.entries[6].entry);
  assert.equal(output.decisions[6].approvedEntrySha256, sha256(batch.entries[6].entry));
  assert.deepEqual(output.reviewers, ["reviewer-1", "reviewer-2"]);
  assert.deepEqual(
    JSON.parse(await readFile(decisionsPath, "utf8")),
    output,
  );

  const summaryResponse = await request(
    createHandler({ reviewsDir }),
    "/api/editorial/reconciliation",
  );
  assert.equal(summaryResponse.status, 200, summaryResponse.text());
  const summaryDocument = summaryResponse.json();
  assert.equal(summaryDocument.kind, "fjale-editorial-reconciliation-summary");
  assert.equal(Object.hasOwn(summaryDocument, "entries"), false);
  assert.equal(summaryDocument.reviewers.length, 3);
  assert.equal(Object.hasOwn(summaryDocument.summary, "approved"), false);
  assert.equal(summaryDocument.reviewers.every((reviewer) => !Object.hasOwn(reviewer, "reviewerId")), true);
  assert.doesNotMatch(summaryResponse.text(), /"verdict"|"reason"|"notes"|"reviewedAt"/u);
});

test("single-reviewer reconciliation is restricted to the approved frozen batch and reviewer", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "fjale-single-reviewer-test-"));
  const reviewsDir = resolve(directory, "reviews");
  const decisionsPath = resolve(directory, "decisions", "result.json");
  const batch = await readEditorialBatch();
  await atomicWriteReview(reviewsDir, createCompleteReview(batch, "neki"));

  assert.equal(isSingleReviewerException(batch.batch, ["neki"]), true);
  assert.equal(isSingleReviewerException(batch.batch, ["other-reviewer"]), false);
  assert.equal(
    isSingleReviewerException({ ...batch.batch, id: "answers-future-batch" }, ["neki"]),
    false,
  );
  assert.equal(
    isSingleReviewerException({ ...batch.batch, sourceCatalogSha256: "0".repeat(64) }, ["neki"]),
    false,
  );

  await assert.rejects(
    reconcileEditorialReviews({
      reviewsDir,
      decisionsPath,
      generatedAt: FIXED_TIME,
      reviewerIds: ["neki"],
    }),
    /at least two independent reviewer IDs/u,
  );
  await assert.rejects(
    reconcileEditorialReviews({
      reviewsDir,
      decisionsPath,
      generatedAt: FIXED_TIME,
      allowSingleReviewerException: true,
    }),
    /requires an explicit reviewer ID/u,
  );
  await assert.rejects(
    reconcileEditorialReviews({
      reviewsDir,
      decisionsPath,
      generatedAt: FIXED_TIME,
      reviewerIds: ["other-reviewer"],
      allowSingleReviewerException: true,
    }),
    /limited to batch answers-2026-07-62-137-v1 and reviewer neki/u,
  );

  const { output } = await reconcileEditorialReviews({
    reviewsDir,
    decisionsPath,
    generatedAt: FIXED_TIME,
    reviewerIds: ["neki"],
    allowSingleReviewerException: true,
  });
  assert.deepEqual(output.reviewers, ["neki"]);
  assert.equal(output.summary.approved, 76);
  assert.equal(output.summary.incomplete, 0);
  assert.equal(output.decisions.every(({ outcome }) => outcome === "approve_daily"), true);
  assert.equal(
    output.decisions.every(
      ({ reviews }) => reviews.length === 1 && reviews[0].reviewerId === "neki",
    ),
    true,
  );
});
