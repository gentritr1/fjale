export function reviewRecordsEqual(left, right) {
  if (left === undefined || right === undefined) return left === right;
  return JSON.stringify(left) === JSON.stringify(right);
}

export function tabReviewBackupKey(sharedKey, tabId) {
  if (typeof sharedKey !== "string" || sharedKey === "") {
    throw new TypeError("sharedKey must be a nonempty string.");
  }
  if (typeof tabId !== "string" || tabId === "") {
    throw new TypeError("tabId must be a nonempty string.");
  }
  return `${sharedKey}:tab:${tabId}`;
}

export function writeReviewBackup(storage, sharedKey, tabId, serializedReview) {
  if (!storage || typeof storage.setItem !== "function") {
    throw new TypeError("storage must provide setItem.");
  }
  if (typeof serializedReview !== "string") {
    throw new TypeError("serializedReview must be a string.");
  }

  // Write the tab-owned copy first. Another tab may replace the shared
  // compatibility copy immediately afterwards, but it cannot replace this one.
  storage.setItem(tabReviewBackupKey(sharedKey, tabId), serializedReview);
  storage.setItem(sharedKey, serializedReview);
}

export function readReviewBackup(storage, sharedKey, tabId) {
  if (!storage || typeof storage.getItem !== "function") {
    throw new TypeError("storage must provide getItem.");
  }
  return readReviewBackupCandidates(storage, sharedKey, tabId)[0]?.serializedReview ?? null;
}

export function readReviewBackupCandidates(storage, sharedKey, tabId) {
  if (!storage || typeof storage.getItem !== "function") {
    throw new TypeError("storage must provide getItem.");
  }
  const currentTabKey = tabReviewBackupKey(sharedKey, tabId);
  const tabKeyPrefix = `${sharedKey}:tab:`;
  const keys = [currentTabKey];

  if (
    typeof storage.key === "function" &&
    Number.isSafeInteger(storage.length) &&
    storage.length >= 0
  ) {
    const discoveredKeys = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (typeof key === "string" && key.startsWith(tabKeyPrefix) && key !== currentTabKey) {
        discoveredKeys.push(key);
      }
    }
    keys.push(...discoveredKeys.sort());
  }
  keys.push(sharedKey);

  const candidates = [];
  const seenValues = new Set();
  for (const key of keys) {
    const serializedReview = storage.getItem(key);
    if (serializedReview === null || seenValues.has(serializedReview)) continue;
    seenValues.add(serializedReview);
    candidates.push({
      key,
      serializedReview,
      currentTab: key === currentTabKey,
      sharedFallback: key === sharedKey,
    });
  }
  return candidates;
}

export async function claimReviewTabId({
  storage,
  storageKey,
  createId,
  lockManager,
  lockNamePrefix = "fjale-editorial-tab:",
  BroadcastChannelClass,
  channelName,
  navigationType = "",
  probeWaitMs = 40,
}) {
  if (typeof createId !== "function") {
    throw new TypeError("createId must be a function.");
  }

  let storedTabId = null;
  try {
    storedTabId = storage?.getItem(storageKey) || null;
  } catch {
    // A private browsing policy may block session storage.
  }

  let tabId = storedTabId || createId();
  if (storedTabId && !["reload", "back_forward"].includes(navigationType)) {
    // Browsers copy sessionStorage when a tab is duplicated. A fresh
    // navigation must therefore rotate before any cross-tab response arrives.
    tabId = createId();
  }

  if (lockManager && typeof lockManager.request === "function") {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const heldLock = await tryHoldExclusiveLock(lockManager, `${lockNamePrefix}${tabId}`);
      if (!heldLock.supported) break;
      if (heldLock.acquired) {
        writeSessionValue(storage, storageKey, tabId);
        return { tabId, close: heldLock.close };
      }
      tabId = createId();
    }
  }

  if (typeof BroadcastChannelClass !== "function") {
    writeSessionValue(storage, storageKey, tabId);
    return { tabId, close() {} };
  }

  let channel;
  try {
    channel = new BroadcastChannelClass(channelName);
  } catch {
    writeSessionValue(storage, storageKey, tabId);
    return { tabId, close() {} };
  }
  const instanceId = createId();
  let pendingProbeId = null;
  let occupied = false;
  let closed = false;
  const onMessage = (event) => {
    const message = event?.data;
    if (!message || typeof message !== "object") return;

    if (
      message.type === "probe" &&
      message.tabId === tabId &&
      message.instanceId !== instanceId
    ) {
      try {
        channel.postMessage({
          type: "occupied",
          tabId,
          probeId: message.probeId,
          targetInstanceId: message.instanceId,
        });
      } catch {
        // A fresh navigation already rotated. Reloads still keep their
        // tab-owned snapshot and can discover every other backup by prefix.
      }
      return;
    }

    if (
      message.type === "occupied" &&
      message.tabId === tabId &&
      message.probeId === pendingProbeId &&
      message.targetInstanceId === instanceId
    ) {
      occupied = true;
    }
  };
  const close = () => {
    if (closed) return;
    closed = true;
    try {
      channel.removeEventListener("message", onMessage);
    } catch {
      // The channel may have failed during construction or setup.
    }
    try {
      channel.close();
    } catch {
      // Nothing else relies on the failed channel.
    }
  };
  try {
    channel.addEventListener("message", onMessage);
  } catch {
    close();
    writeSessionValue(storage, storageKey, tabId);
    return { tabId, close() {} };
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    occupied = false;
    pendingProbeId = createId();
    try {
      channel.postMessage({ type: "probe", tabId, instanceId, probeId: pendingProbeId });
    } catch {
      close();
      writeSessionValue(storage, storageKey, tabId);
      return { tabId, close() {} };
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, probeWaitMs));
    if (!occupied) break;
    tabId = createId();
  }
  pendingProbeId = null;
  writeSessionValue(storage, storageKey, tabId);

  return {
    tabId,
    close,
  };
}

async function tryHoldExclusiveLock(lockManager, name) {
  let resolveAttempt;
  const attemptStarted = new Promise((resolveStarted) => {
    resolveAttempt = resolveStarted;
  });
  let releaseHold;
  const hold = new Promise((resolveHold) => {
    releaseHold = resolveHold;
  });
  let requestPromise;

  try {
    requestPromise = Promise.resolve(
      lockManager.request(
        name,
        { mode: "exclusive", ifAvailable: true },
        async (lock) => {
          if (!lock) {
            resolveAttempt({ acquired: false, failed: false });
            return;
          }
          resolveAttempt({ acquired: true, failed: false });
          await hold;
        },
      ),
    );
  } catch {
    return { supported: false, acquired: false, close() {} };
  }

  requestPromise.catch(() => {
    resolveAttempt({ acquired: false, failed: true });
  });
  const result = await attemptStarted;
  if (!result.acquired) {
    releaseHold();
    await requestPromise.catch(() => {});
    return { supported: !result.failed, acquired: false, close() {} };
  }

  let released = false;
  return {
    supported: true,
    acquired: true,
    close() {
      if (released) return;
      released = true;
      releaseHold();
      void requestPromise.catch(() => {});
    },
  };
}

function writeSessionValue(storage, key, value) {
  try {
    storage?.setItem(key, value);
  } catch {
    // The in-memory id still protects this page when storage is blocked.
  }
}

function reviewRecordTimestamp(record) {
  const parsed = Date.parse(record?.updatedAt ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

export function shouldApplyIncomingReviewRecord({
  currentRecord,
  incomingRecord,
  onlyNewer = false,
  preferIncomingOnTie = false,
  forceIncoming = false,
}) {
  if (forceIncoming || !onlyNewer || !currentRecord) return true;
  const incomingTimestamp = reviewRecordTimestamp(incomingRecord);
  const currentTimestamp = reviewRecordTimestamp(currentRecord);
  return (
    incomingTimestamp > currentTimestamp ||
    (preferIncomingOnTie && incomingTimestamp === currentTimestamp)
  );
}

export function threeWayMergeReviewRecords({
  baseRecords,
  latestRecords,
  localRecords,
  dirtyAnswerIds,
}) {
  for (const [label, value] of Object.entries({ baseRecords, latestRecords, localRecords })) {
    if (!(value instanceof Map)) throw new TypeError(`${label} must be a Map.`);
  }
  if (!(dirtyAnswerIds instanceof Set)) {
    throw new TypeError("dirtyAnswerIds must be a Set.");
  }

  const conflictIds = [...dirtyAnswerIds].filter((answerId) => {
    const localRecord = localRecords.has(answerId) ? localRecords.get(answerId) : undefined;
    return (
      !reviewRecordsEqual(baseRecords.get(answerId), latestRecords.get(answerId)) &&
      !reviewRecordsEqual(localRecord, latestRecords.get(answerId))
    );
  });
  const records = new Map(
    [...latestRecords].map(([answerId, record]) => [answerId, structuredClone(record)]),
  );

  for (const answerId of dirtyAnswerIds) {
    if (!localRecords.has(answerId) || localRecords.get(answerId) === undefined) {
      records.delete(answerId);
      continue;
    }
    records.set(answerId, structuredClone(localRecords.get(answerId)));
  }

  return { records, conflictIds };
}

export function rebaseDirtyReviewRecords({
  baseRecords,
  latestRecords,
  currentRecords,
  dirtyAnswerIds,
}) {
  if (!(currentRecords instanceof Map)) {
    throw new TypeError("currentRecords must be a Map.");
  }
  if (!(dirtyAnswerIds instanceof Set)) {
    throw new TypeError("dirtyAnswerIds must be a Set.");
  }

  const localRecords = new Map(
    [...dirtyAnswerIds].map((answerId) => [
      answerId,
      currentRecords.has(answerId) ? structuredClone(currentRecords.get(answerId)) : undefined,
    ]),
  );
  return threeWayMergeReviewRecords({
    baseRecords,
    latestRecords,
    localRecords,
    dirtyAnswerIds: new Set(dirtyAnswerIds),
  });
}

export function restoreReviewBackupRecords({
  baseRecords,
  latestRecords,
  localRecords,
  dirtyAnswerIds,
  conflictedAnswerIds = new Set(),
}) {
  if (!(conflictedAnswerIds instanceof Set)) {
    throw new TypeError("conflictedAnswerIds must be a Set.");
  }
  const restored = threeWayMergeReviewRecords({
    baseRecords,
    latestRecords,
    localRecords,
    dirtyAnswerIds,
  });
  const conflictIds = new Set(restored.conflictIds);
  for (const answerId of conflictedAnswerIds) {
    if (dirtyAnswerIds.has(answerId)) conflictIds.add(answerId);
  }
  return { records: restored.records, conflictIds: [...conflictIds] };
}
