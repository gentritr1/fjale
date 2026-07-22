import {
  claimReviewTabId,
  readReviewBackupCandidates,
  rebaseDirtyReviewRecords,
  restoreReviewBackupRecords,
  reviewRecordsEqual,
  shouldApplyIncomingReviewRecord,
  writeReviewBackup,
} from "/admin/review-merge.js";

const API = Object.freeze({
  batch: "/api/editorial/batch",
  review: "/api/editorial/review",
  reconciliation: "/api/editorial/reconciliation",
});

const STORAGE_PREFIX = "fjale-editorial-review-v1";
const LAST_REVIEWER_KEY = "fjale-editorial-last-reviewer-v1";
const REVIEW_TAB_ID_KEY = "fjale-editorial-tab-id-v1";
const REVIEW_TAB_CHANNEL = "fjale-editorial-tab-claims-v1";
let REVIEW_TAB_ID = "";
let releaseReviewTabClaim = () => {};
let editorPageDisposed = false;
const ALBANIAN_DIGRAPHS = new Set(["DH", "GJ", "LL", "NJ", "RR", "SH", "TH", "XH", "ZH"]);
const ENTRY_FIELDS = Object.freeze([
  "id",
  "word",
  "partOfSpeech",
  "syllables",
  "clue",
  "definition",
  "example",
  "region",
]);
const ENTRY_STRING_FIELDS = Object.freeze(ENTRY_FIELDS.filter((field) => field !== "id"));
const EDITABLE_FIELDS = Object.freeze(
  ENTRY_STRING_FIELDS.filter((field) => field !== "word"),
);
const METADATA_FIELDS = EDITABLE_FIELDS;
const ENTRY_STRING_LIMITS = Object.freeze({
  word: 32,
  partOfSpeech: 64,
  syllables: 64,
  clue: 300,
  definition: 600,
  example: 600,
  region: 64,
});
const ALLOWED_VERDICTS = new Set([
  "approve_daily",
  "practice_only",
  "needs_revision",
  "reject_content",
]);

const VERDICT_META = Object.freeze({
  approve_daily: Object.freeze({ label: "Pranuar për ditore", symbol: "✓" }),
  practice_only: Object.freeze({ label: "Vetëm për praktikë", symbol: "∞" }),
  needs_revision: Object.freeze({ label: "Për korrigjim", symbol: "↺" }),
  reject_content: Object.freeze({ label: "Përmbajtje e refuzuar", symbol: "×" }),
});

const dom = {
  loadingPanel: document.querySelector("#loading-panel"),
  errorPanel: document.querySelector("#error-panel"),
  errorCopy: document.querySelector("#error-copy"),
  retryButton: document.querySelector("#retry-button"),
  setupPanel: document.querySelector("#setup-panel"),
  setupContext: document.querySelector("#setup-context"),
  reviewerForm: document.querySelector("#reviewer-form"),
  reviewerInput: document.querySelector("#reviewer-id"),
  reviewerError: document.querySelector("#reviewer-error"),
  editorApp: document.querySelector("#editor-app"),
  saveStatus: document.querySelector("#save-status"),
  saveStatusCopy: document.querySelector("#save-status-copy"),
  undoButton: document.querySelector("#undo-button"),
  downloadButton: document.querySelector("#download-button"),
  downloadButtonCopy: document.querySelector("#download-button-copy"),
  batchName: document.querySelector("#batch-name"),
  changeReviewerButton: document.querySelector("#change-reviewer-button"),
  progressTitle: document.querySelector("#progress-title"),
  progressPercent: document.querySelector("#progress-percent"),
  progressTrack: document.querySelector("#progress-track"),
  progressBar: document.querySelector("#progress-bar"),
  countAll: document.querySelector("#count-all"),
  countPending: document.querySelector("#count-pending"),
  countAttention: document.querySelector("#count-attention"),
  filterButtons: [...document.querySelectorAll("[data-filter]")],
  queueList: document.querySelector("#queue-list"),
  reconciliationPanel: document.querySelector("#reconciliation-panel"),
  reconciliationCopy: document.querySelector("#reconciliation-copy"),
  previousButton: document.querySelector("#previous-button"),
  nextButton: document.querySelector("#next-button"),
  candidatePosition: document.querySelector("#candidate-position"),
  candidateCard: document.querySelector("#candidate-card"),
  candidateId: document.querySelector("#candidate-id"),
  decisionBadge: document.querySelector("#decision-badge"),
  candidateWord: document.querySelector("#candidate-word"),
  letterTiles: document.querySelector("#letter-tiles"),
  sourceBadge: document.querySelector("#source-badge"),
  metadataList: document.querySelector("#metadata-list"),
  viewFields: Object.fromEntries(
    METADATA_FIELDS.map((field) => [
      field,
      document.querySelector(`#view-${toKebabCase(field)}`),
    ]),
  ),
  editToggle: document.querySelector("#edit-toggle"),
  editPanel: document.querySelector("#edit-panel"),
  editState: document.querySelector("#edit-state"),
  entryForm: document.querySelector("#entry-form"),
  recordConflict: document.querySelector("#record-conflict"),
  recordConflictDetails: document.querySelector("#record-conflict-details"),
  recordConflictComparison: document.querySelector("#record-conflict-comparison"),
  useDiskButton: document.querySelector("#use-disk-button"),
  keepLocalButton: document.querySelector("#keep-local-button"),
  editFields: Object.fromEntries(
    EDITABLE_FIELDS.map((field) => [field, document.querySelector(`#edit-${toKebabCase(field)}`)]),
  ),
  entryValidation: document.querySelector("#entry-validation"),
  resetEntryButton: document.querySelector("#reset-entry-button"),
  verdictButtons: [...document.querySelectorAll("[data-verdict]")],
  decisionDetails: document.querySelector("#decision-details"),
  decisionReason: document.querySelector("#decision-reason"),
  decisionNotes: document.querySelector("#decision-notes"),
  decisionError: document.querySelector("#decision-error"),
  decisionSavedAt: document.querySelector("#decision-saved-at"),
  skipButton: document.querySelector("#skip-button"),
  emptyPanel: document.querySelector("#empty-panel"),
  showAllButton: document.querySelector("#show-all-button"),
  toast: document.querySelector("#toast"),
  liveRegion: document.querySelector("#live-region"),
};

const state = {
  batchDocument: null,
  entriesById: new Map(),
  reviewerId: "",
  records: new Map(),
  activeAnswerId: null,
  filter: "all",
  startedAt: null,
  updatedAt: null,
  undoStack: [],
  saveTimer: null,
  saveInFlight: false,
  saveQueued: false,
  toastTimer: null,
  swipe: null,
  sessionVersion: 0,
  serverEtag: null,
  serverRecords: new Map(),
  dirtyAnswerIds: new Set(),
  conflictedAnswerIds: new Set(),
  recoveryBackups: [],
};

bindStaticEvents();
void initializeEditor();

async function initializeEditor() {
  const navigationType = performance.getEntriesByType("navigation")[0]?.type ?? "";
  const claim = await claimReviewTabId({
    storage: readSessionStorage(),
    storageKey: REVIEW_TAB_ID_KEY,
    createId: createReviewTabId,
    lockManager: readNavigatorLocks(),
    BroadcastChannelClass: globalThis.BroadcastChannel,
    channelName: REVIEW_TAB_CHANNEL,
    navigationType,
  });
  if (editorPageDisposed) {
    claim.close();
    return;
  }
  REVIEW_TAB_ID = claim.tabId;
  releaseReviewTabClaim = claim.close;
  await loadBatch();
}

function bindStaticEvents() {
  dom.retryButton.addEventListener("click", loadBatch);
  dom.reviewerForm.addEventListener("submit", handleReviewerSubmit);
  dom.reviewerInput.addEventListener("input", () => {
    dom.reviewerInput.value = normalizeReviewerId(dom.reviewerInput.value);
    clearReviewerError();
  });
  dom.changeReviewerButton.addEventListener("click", changeReviewer);
  dom.downloadButton.addEventListener("click", downloadReview);
  dom.undoButton.addEventListener("click", undoLastDecision);
  dom.previousButton.addEventListener("click", () => navigate(-1));
  dom.nextButton.addEventListener("click", () => navigate(1));
  dom.skipButton.addEventListener("click", skipCandidate);
  dom.showAllButton.addEventListener("click", () => setFilter("all"));
  dom.editToggle.addEventListener("click", toggleEditPanel);
  dom.resetEntryButton.addEventListener("click", resetCurrentEntry);
  dom.useDiskButton.addEventListener("click", useDiskConflictVersion);
  dom.keepLocalButton.addEventListener("click", keepLocalConflictVersion);

  dom.filterButtons.forEach((button) => {
    button.addEventListener("click", () => setFilter(button.dataset.filter));
  });

  dom.verdictButtons.forEach((button) => {
    button.addEventListener("click", () => setVerdict(button.dataset.verdict));
  });

  Object.entries(dom.editFields).forEach(([field, input]) => {
    input.addEventListener("input", () => updateEditedField(field, input.value));
  });

  dom.decisionReason.addEventListener("change", updateDecisionDetails);
  dom.decisionNotes.addEventListener("input", updateDecisionDetails);
  document.addEventListener("keydown", handleKeyboardShortcut);
  window.addEventListener("beforeunload", persistLocalBackup);
  window.addEventListener("storage", handleReviewBackupStorageChange);
  window.addEventListener("pagehide", (event) => {
    if (!event.persisted) {
      editorPageDisposed = true;
      releaseReviewTabClaim();
    }
  });

  dom.candidateCard.addEventListener("pointerdown", startSwipe);
  dom.candidateCard.addEventListener("pointermove", moveSwipe);
  dom.candidateCard.addEventListener("pointerup", endSwipe);
  dom.candidateCard.addEventListener("pointercancel", cancelSwipe);
}

async function loadBatch() {
  showOnly(dom.loadingPanel);
  setSaveStatus("loading", "Duke hapur grupin…");

  try {
    const response = await fetch(API.batch, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Serveri u përgjigj me ${response.status}.`);
    }

    const batchDocument = await response.json();
    validateBatchDocument(batchDocument);
    state.batchDocument = batchDocument;
    state.entriesById = new Map(batchDocument.entries.map((candidate) => [candidate.answerId, candidate]));
    state.records.clear();
    state.activeAnswerId = batchDocument.entries[0]?.answerId ?? null;
    state.filter = "all";
    state.undoStack = [];

    dom.setupContext.textContent = `${batchDocument.batch.id} · ${batchDocument.entries.length} kandidatë`;
    dom.reviewerInput.value = normalizeReviewerId(readLocalValue(LAST_REVIEWER_KEY) ?? "");
    showOnly(dom.setupPanel);
    setSaveStatus("ready", "Grupi është gati");
    requestAnimationFrame(() => dom.reviewerInput.focus());
  } catch (error) {
    showLoadError(error);
  }
}

function validateBatchDocument(documentValue) {
  if (!documentValue || typeof documentValue !== "object") {
    throw new Error("Përgjigjja e grupit nuk është objekt JSON.");
  }
  if (!documentValue.batch || typeof documentValue.batch.id !== "string") {
    throw new Error("Grupit i mungon identifikuesi.");
  }
  if (!Array.isArray(documentValue.entries)) {
    throw new Error("Grupit i mungon lista e kandidatëve.");
  }

  const seenIds = new Set();
  for (const candidate of documentValue.entries) {
    if (!Number.isInteger(candidate?.answerId) || !candidate.entry || typeof candidate.sourceSha256 !== "string") {
      throw new Error("Një kandidat ka strukturë të pavlefshme.");
    }
    if (seenIds.has(candidate.answerId)) {
      throw new Error(`ID-ja ${candidate.answerId} shfaqet më shumë se një herë.`);
    }
    seenIds.add(candidate.answerId);
  }
}

function showLoadError(error) {
  dom.errorCopy.textContent = readableError(
    error,
    "Sigurohu që serveri redaksional po punon dhe provoje sërish.",
  );
  showOnly(dom.errorPanel);
  setSaveStatus("error", "Grupi nuk u hap");
}

function handleReviewerSubmit(event) {
  event.preventDefault();
  const reviewerId = normalizeReviewerId(dom.reviewerInput.value);
  dom.reviewerInput.value = reviewerId;

  if (!/^[a-z0-9_-]{2,32}$/.test(reviewerId)) {
    showReviewerError("Përdor 2–32 shkronja të vogla, numra, vijë ose nënvizë.");
    return;
  }

  writeLocalValue(LAST_REVIEWER_KEY, reviewerId);
  void beginReview(reviewerId);
}

async function beginReview(reviewerId) {
  const sessionVersion = state.sessionVersion + 1;
  state.sessionVersion = sessionVersion;
  state.reviewerId = reviewerId;
  state.serverEtag = null;
  state.serverRecords.clear();
  state.dirtyAnswerIds.clear();
  state.conflictedAnswerIds.clear();
  state.recoveryBackups = [];
  state.records.clear();
  state.startedAt = new Date().toISOString();
  state.updatedAt = state.startedAt;
  state.undoStack = [];
  showOnly(dom.loadingPanel);
  setSaveStatus("loading", `Po hapet rishikimi i ${reviewerId}…`);

  try {
    const serverResult = await fetchSavedReview(reviewerId);
    if (sessionVersion !== state.sessionVersion) return;
    const serverReview = serverResult.review;
    state.serverEtag = serverResult.etag;
    if (serverReview) {
      hydrateReview(serverReview);
      state.serverRecords = recordsFromReview(serverReview);
    }
    const localReview = readLocalReview(reviewerId);
    if (localReview) {
      const restoredBackup = restoreLocalReviewFromMergeBase(localReview);
      if (restoredBackup) {
        hydrateReviewTimestamps(localReview, { adoptStartedAt: !serverReview });
        state.records = restoredBackup.records;
        for (const answerId of restoredBackup.conflictIds) {
          state.conflictedAnswerIds.add(answerId);
        }
      } else {
        const localConflictIds = new Set(
          (Array.isArray(localReview.conflictedAnswerIds)
            ? localReview.conflictedAnswerIds
            : []
          ).filter((answerId) => state.entriesById.has(answerId)),
        );
        const hydratedLocalIds = hydrateReview(localReview, {
          adoptStartedAt: !serverReview,
          onlyNewer: Boolean(serverReview),
          preferIncomingOnTie: true,
          forceIncomingAnswerIds: localConflictIds,
          replaceExistingRecords: Array.isArray(localReview.localRecords),
        });
        for (const answerId of localConflictIds) {
          if (hydratedLocalIds.has(answerId)) state.conflictedAnswerIds.add(answerId);
        }
      }
    }
    refreshDirtyAnswerIds();

    const firstConflictId = [...state.conflictedAnswerIds][0] ?? null;
    state.activeAnswerId =
      firstConflictId ??
      (state.dirtyAnswerIds.size > 0 ? [...state.dirtyAnswerIds][0] : null) ??
      chooseInitialCandidate();
    dom.batchName.textContent = state.batchDocument.batch.id;
    dom.downloadButton.disabled = false;
    showOnly(dom.editorApp);
    renderAll();

    if (firstConflictId !== null) {
      const conflictWord = state.entriesById.get(firstConflictId)?.entry.word;
      openEditPanel();
      setSaveStatus("error", `Konflikt${conflictWord ? ` te ${conflictWord}` : ""} · zgjidh versionin`);
      showToast(
        "Versioni lokal dhe ai në disk ndryshojnë. Zgjidh qartë cilin version të mbash.",
        true,
      );
    } else if (state.dirtyAnswerIds.size > 0) {
      if (serverReview) {
        setSaveStatus("local", "Kopja lokale u bashkua · shqyrto ndryshimet");
        showToast("Ka ndryshime lokale mbi versionin në disk. Kontrolloji para ruajtjes tjetër.");
      } else {
        setSaveStatus("local", "Kopja lokale u rikthye");
        scheduleSave();
      }
    } else if (serverReview || localReview) {
      setSaveStatus("saved", "Rishikimi u hap");
    } else {
      setSaveStatus("ready", "Rishikim i ri");
    }

    const activeWord = getActiveCandidate()?.entry.word;
    if (activeWord) {
      announce(`U hap rishikimi i ${reviewerId}. Fjala e parë: ${activeWord}.`);
      requestAnimationFrame(() => dom.candidateWord.focus());
    }
    void loadReconciliation();
  } catch (error) {
    if (sessionVersion !== state.sessionVersion) return;
    dom.errorCopy.textContent = readableError(error, "Rishikimi nuk mundi të hapej.");
    showOnly(dom.errorPanel);
    setSaveStatus("error", "Rishikimi nuk u hap");
  }
}

async function fetchSavedReview(reviewerId) {
  const url = `${API.review}?reviewer=${encodeURIComponent(reviewerId)}`;
  const response = await fetch(url, { cache: "no-store" });
  if (response.status === 404) {
    return { review: null, etag: null };
  }
  if (!response.ok) {
    throw new Error(`Rishikimi nuk u lexua (${response.status}).`);
  }
  return {
    review: await response.json(),
    etag: response.headers.get("ETag"),
  };
}

function hydrateReview(
  reviewDocument,
  {
    adoptStartedAt = true,
    onlyNewer = false,
    preferIncomingOnTie = false,
    forceIncomingAnswerIds = new Set(),
    replaceExistingRecords = false,
  } = {},
) {
  hydrateReviewTimestamps(reviewDocument, { adoptStartedAt });

  const decisions = Array.isArray(reviewDocument.decisions)
    ? reviewDocument.decisions
    : Array.isArray(reviewDocument.items)
      ? reviewDocument.items
      : [];
  const drafts = Array.isArray(reviewDocument.drafts) ? reviewDocument.drafts : [];

  const hydratedAnswerIds = new Set();
  for (const rawRecord of [...drafts, ...decisions]) {
    const candidate = state.entriesById.get(rawRecord?.answerId);
    if (!candidate || rawRecord.sourceSha256 !== candidate.sourceSha256) {
      continue;
    }

    const current = state.records.get(candidate.answerId);
    const normalized = normalizeRecord(
      rawRecord,
      candidate,
      replaceExistingRecords ? undefined : current,
    );
    if (!shouldApplyIncomingReviewRecord({
      currentRecord: current,
      incomingRecord: normalized,
      onlyNewer,
      preferIncomingOnTie,
      forceIncoming: forceIncomingAnswerIds.has(candidate.answerId),
    })) {
      continue;
    }
    state.records.set(candidate.answerId, normalized);
    hydratedAnswerIds.add(candidate.answerId);
  }
  return hydratedAnswerIds;
}

function hydrateReviewTimestamps(reviewDocument, { adoptStartedAt = true } = {}) {
  if (adoptStartedAt) {
    state.startedAt = validTimestamp(reviewDocument.startedAt) ?? state.startedAt;
  }
  const reviewUpdatedAt = validTimestamp(reviewDocument.updatedAt);
  if (reviewUpdatedAt && parseTimestamp(reviewUpdatedAt) > parseTimestamp(state.updatedAt)) {
    state.updatedAt = reviewUpdatedAt;
  }
}

function restoreLocalReviewFromMergeBase(localReview) {
  if (
    !Array.isArray(localReview.baseRecords) ||
    !Array.isArray(localReview.localRecords) ||
    !Array.isArray(localReview.dirtyAnswerIds)
  ) {
    return null;
  }
  const baseRecords = recordsFromBackup(localReview.baseRecords);
  const localRecords = recordsFromBackup(localReview.localRecords);
  const dirtyAnswerIds = answerIdsFromBackup(localReview.dirtyAnswerIds);
  const conflictedAnswerIds = answerIdsFromBackup(
    Array.isArray(localReview.conflictedAnswerIds) ? localReview.conflictedAnswerIds : [],
  );
  if (!baseRecords || !localRecords || !dirtyAnswerIds || !conflictedAnswerIds) return null;

  return restoreReviewBackupRecords({
    baseRecords,
    latestRecords: state.serverRecords,
    localRecords,
    dirtyAnswerIds,
    conflictedAnswerIds,
  });
}

function recordsFromBackup(rawRecords) {
  const records = new Map();
  for (const rawRecord of rawRecords) {
    const candidate = state.entriesById.get(rawRecord?.answerId);
    if (
      !candidate ||
      records.has(candidate.answerId) ||
      rawRecord.sourceSha256 !== candidate.sourceSha256
    ) {
      return null;
    }
    records.set(candidate.answerId, normalizeRecord(rawRecord, candidate));
  }
  return records;
}

function answerIdsFromBackup(rawAnswerIds) {
  const answerIds = new Set();
  for (const answerId of rawAnswerIds) {
    if (!state.entriesById.has(answerId) || answerIds.has(answerId)) return null;
    answerIds.add(answerId);
  }
  return answerIds;
}

function recordsFromReview(reviewDocument) {
  const result = new Map();
  const decisions = Array.isArray(reviewDocument.decisions) ? reviewDocument.decisions : [];
  const drafts = Array.isArray(reviewDocument.drafts) ? reviewDocument.drafts : [];
  for (const rawRecord of [...drafts, ...decisions]) {
    const candidate = state.entriesById.get(rawRecord?.answerId);
    if (!candidate || rawRecord.sourceSha256 !== candidate.sourceSha256) continue;
    const normalized = normalizeRecord(rawRecord, candidate, result.get(candidate.answerId));
    result.set(candidate.answerId, normalized);
  }
  return result;
}

function recordHasLocalContent(record) {
  if (!record) return false;
  const candidate = state.entriesById.get(record.answerId);
  return Boolean(
    record.verdict ||
      cleanText(record.notes) ||
      (candidate && entriesDiffer(candidate.entry, record.proposedEntry)),
  );
}

function refreshDirtyAnswerIds() {
  const dirty = new Set();
  const answerIds = new Set([...state.serverRecords.keys(), ...state.records.keys()]);
  for (const answerId of answerIds) {
    const localRecord = state.records.get(answerId);
    const serverRecord = state.serverRecords.get(answerId);
    if (!serverRecord && !recordHasLocalContent(localRecord)) continue;
    if (!reviewRecordsEqual(localRecord, serverRecord)) dirty.add(answerId);
  }
  state.dirtyAnswerIds = dirty;
}

function markRecordDirty(answerId) {
  if (Number.isSafeInteger(answerId)) state.dirtyAnswerIds.add(answerId);
}

function normalizeRecord(rawRecord, candidate, currentRecord) {
  const verdict = ALLOWED_VERDICTS.has(rawRecord.verdict) ? rawRecord.verdict : currentRecord?.verdict ?? null;
  const proposedEntry = sanitizeEntry(rawRecord.proposedEntry ?? currentRecord?.proposedEntry, candidate.entry);
  proposedEntry.id = candidate.entry.id;
  proposedEntry.word = candidate.entry.word;
  return {
    answerId: candidate.answerId,
    sourceSha256: candidate.sourceSha256,
    verdict,
    proposedEntry,
    reason: cleanText(rawRecord.reason ?? currentRecord?.reason),
    notes: cleanText(rawRecord.notes ?? currentRecord?.notes),
    reviewedAt: validTimestamp(rawRecord.reviewedAt) ?? currentRecord?.reviewedAt ?? null,
    updatedAt:
      validTimestamp(rawRecord.updatedAt) ??
      validTimestamp(rawRecord.reviewedAt) ??
      currentRecord?.updatedAt ??
      new Date().toISOString(),
  };
}

function chooseInitialCandidate() {
  const firstPending = state.batchDocument.entries.find(
    (candidate) => !isReviewComplete(getRecord(candidate.answerId)),
  );
  return firstPending?.answerId ?? state.batchDocument.entries[0]?.answerId ?? null;
}

function renderAll() {
  renderProgress();
  renderFilters();
  renderQueue();
  renderCandidate();
  renderUndoState();
}

function renderProgress() {
  const total = state.batchDocument.entries.length;
  const completed = state.batchDocument.entries.reduce(
    (count, candidate) => count + Number(isReviewComplete(getRecord(candidate.answerId))),
    0,
  );
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);

  dom.progressTitle.textContent = `${completed} nga ${total} të vendosura`;
  dom.progressPercent.textContent = `${percent}%`;
  dom.progressTrack.setAttribute("aria-valuemax", String(total));
  dom.progressTrack.setAttribute("aria-valuenow", String(completed));
  dom.progressBar.style.transform = `scaleX(${percent / 100})`;
}

function renderFilters() {
  const entries = state.batchDocument.entries;
  const pending = entries.filter(
    (candidate) => !isReviewComplete(getRecord(candidate.answerId)),
  ).length;
  const attention = entries.filter((candidate) => isAttentionRecord(getRecord(candidate.answerId))).length;
  dom.countAll.textContent = String(entries.length);
  dom.countPending.textContent = String(pending);
  dom.countAttention.textContent = String(attention);

  dom.filterButtons.forEach((button) => {
    const active = button.dataset.filter === state.filter;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function renderQueue() {
  const entries = getFilteredEntries();
  const fragment = document.createDocumentFragment();

  entries.forEach((candidate) => {
    const record = getRecord(candidate.answerId);
    const item = document.createElement("li");
    const button = document.createElement("button");
    const number = document.createElement("span");
    const word = document.createElement("span");
    const result = document.createElement("span");
    const meta = record?.verdict ? VERDICT_META[record.verdict] : null;

    button.type = "button";
    button.className = "queue-item-button";
    button.dataset.answerId = String(candidate.answerId);
    button.setAttribute("aria-current", String(candidate.answerId === state.activeAnswerId));
    button.setAttribute(
      "aria-label",
      `${candidate.entry.word}, ID ${candidate.answerId}, ${queueStateLabel(record)}`,
    );
    button.addEventListener("click", () => selectCandidate(candidate.answerId));

    number.className = "queue-number";
    number.textContent = `#${candidate.answerId}`;
    word.className = "queue-word";
    word.textContent = candidate.entry.word;
    result.className = "queue-state";
    result.dataset.verdict = record?.verdict ?? "pending";
    result.textContent =
      record && state.conflictedAnswerIds.has(record.answerId)
        ? "!"
        : record && !isRecordEntryValid(record)
        ? "!"
        : record?.verdict && !hasCompleteDecision(record)
          ? "!"
          : meta?.symbol ?? "·";
    result.setAttribute("aria-hidden", "true");

    button.append(number, word, result);
    item.append(button);
    fragment.append(item);
  });

  dom.queueList.replaceChildren(fragment);
  requestAnimationFrame(scrollActiveQueueItemIntoView);
}

function renderCandidate() {
  const candidate = getActiveCandidate();
  const filteredEntries = getFilteredEntries();
  const hasCandidate = Boolean(candidate && filteredEntries.some((entry) => entry.answerId === candidate.answerId));
  dom.candidateCard.hidden = !hasCandidate;
  dom.emptyPanel.hidden = hasCandidate;

  if (!hasCandidate) {
    dom.previousButton.disabled = true;
    dom.nextButton.disabled = true;
    dom.candidatePosition.textContent = "Asnjë kandidat";
    return;
  }

  const record = ensureRecord(candidate.answerId);
  const entry = record.proposedEntry;
  const globalIndex = state.batchDocument.entries.findIndex((item) => item.answerId === candidate.answerId);
  const filterIndex = filteredEntries.findIndex((item) => item.answerId === candidate.answerId);

  dom.candidatePosition.textContent = `Kandidati ${globalIndex + 1} nga ${state.batchDocument.entries.length}`;
  dom.previousButton.disabled = filterIndex <= 0;
  dom.nextButton.disabled = filterIndex < 0 || filterIndex >= filteredEntries.length - 1;
  dom.candidateId.textContent = `ID ${candidate.answerId}`;
  dom.candidateWord.textContent = entry.word || "Pa fjalë";
  dom.sourceBadge.textContent = `burimi ${shortHash(candidate.sourceSha256)}`;
  dom.sourceBadge.title = `SHA-256 i burimit: ${candidate.sourceSha256}`;
  renderLetterTiles(entry.word);

  EDITABLE_FIELDS.forEach((field) => {
    if (dom.viewFields[field]) dom.viewFields[field].textContent = entry[field] || "—";
    dom.editFields[field].value = entry[field] ?? "";
    dom.editFields[field].removeAttribute("aria-invalid");
  });
  const validation = entryValidationMessage(entry, candidate.answerId);
  if (validation) {
    if (validation.field && dom.editFields[validation.field]) {
      dom.editFields[validation.field].setAttribute("aria-invalid", "true");
    }
    dom.entryValidation.textContent = validation.message;
    dom.entryValidation.hidden = false;
  } else {
    dom.entryValidation.hidden = true;
  }
  renderEditState(candidate, record);
  renderDecision(record);
  resetSwipeTransform();
}

function renderLetterTiles(word) {
  const fragment = document.createDocumentFragment();
  tokenizeAlbanian(word).forEach((letter) => {
    const tile = document.createElement("span");
    tile.className = "letter-tile";
    tile.textContent = letter;
    fragment.append(tile);
  });
  dom.letterTiles.replaceChildren(fragment);
}

function renderEditState(candidate, record) {
  const edited = entriesDiffer(candidate.entry, record.proposedEntry);
  const conflicted = state.conflictedAnswerIds.has(record.answerId);
  const conflictWasHidden = dom.recordConflict.hidden;
  dom.editState.textContent = edited ? "Me ndryshime" : "Origjinali";
  dom.editState.classList.toggle("is-edited", edited);
  dom.resetEntryButton.disabled = !edited;
  dom.recordConflict.hidden = !conflicted;
  if (conflicted) {
    renderConflictComparison(record);
    if (conflictWasHidden) dom.recordConflictDetails.open = true;
  }
}

function renderConflictComparison(localRecord) {
  const diskRecord = state.serverRecords.get(localRecord.answerId) ?? null;
  const verdictLabel = (record) =>
    record?.verdict ? VERDICT_META[record.verdict]?.label ?? record.verdict : "Pa vendim";
  const labels = {
    partOfSpeech: "Lloji",
    syllables: "Rrokjet",
    clue: "Gjurma",
    definition: "Përkufizimi",
    example: "Shembulli",
    region: "Regjistri",
  };
  const fields = [
    { label: "Vendimi", read: verdictLabel },
    ...EDITABLE_FIELDS.map((field) => ({
      label: labels[field],
      read: (record) => record?.proposedEntry?.[field] ?? "—",
    })),
    { label: "Arsyeja", read: (record) => record?.reason || "—" },
    { label: "Shënimet", read: (record) => record?.notes || "—" },
  ];
  const differences = fields
    .map((field) => ({
      label: field.label,
      disk: String(field.read(diskRecord)),
      local: String(field.read(localRecord)),
    }))
    .filter(({ disk, local }) => disk !== local);
  const fragment = document.createDocumentFragment();
  const heading = document.createElement("div");
  heading.className = "conflict-diff-row";
  heading.setAttribute("role", "row");
  const emptyHeading = document.createElement("span");
  emptyHeading.setAttribute("role", "columnheader");
  emptyHeading.setAttribute("aria-label", "Fusha");
  heading.append(
    emptyHeading,
    createConflictDiffCell("Në disk", "conflict-diff-heading", "columnheader"),
    createConflictDiffCell("Lokalisht", "conflict-diff-heading", "columnheader"),
  );
  fragment.append(heading);

  if (differences.length === 0) {
    const row = document.createElement("div");
    row.className = "conflict-diff-row";
    row.setAttribute("role", "row");
    const message = createConflictDiffCell(
      "Versionet nuk kanë më ndryshime të dukshme.",
      "conflict-diff-empty",
      "cell",
    );
    message.setAttribute("aria-colspan", "3");
    row.append(message);
    fragment.append(row);
  } else {
    for (const difference of differences) {
      const row = document.createElement("div");
      row.className = "conflict-diff-row";
      row.setAttribute("role", "row");
      row.append(
        createConflictDiffCell(difference.label, "conflict-diff-label", "rowheader"),
        createConflictDiffCell(difference.disk, "conflict-diff-value", "cell"),
        createConflictDiffCell(difference.local, "conflict-diff-value", "cell"),
      );
      fragment.append(row);
    }
  }

  dom.recordConflictComparison.replaceChildren(fragment);
}

function createConflictDiffCell(copy, className, role) {
  const element = document.createElement("span");
  element.className = className;
  element.textContent = copy;
  element.setAttribute("role", role);
  return element;
}

function renderDecision(record) {
  const complete = isReviewComplete(record);
  const conflicted = state.conflictedAnswerIds.has(record.answerId);
  const meta = record.verdict ? VERDICT_META[record.verdict] : null;
  dom.decisionBadge.textContent = record.verdict
    ? conflicted
      ? `${meta.label} · konflikt mes skedave`
      : complete
      ? meta.label
      : hasCompleteDecision(record)
        ? `${meta.label} · të dhëna të pavlefshme`
        : `${meta.label} · mungon arsyeja`
    : "Pa vendim";
  dom.decisionBadge.dataset.verdict = record.verdict ?? "pending";

  dom.verdictButtons.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.verdict === record.verdict));
  });

  const needsDetails = Boolean(record.verdict && record.verdict !== "approve_daily");
  dom.decisionDetails.hidden = !needsDetails;
  dom.decisionReason.value = record.reason ?? "";
  dom.decisionNotes.value = record.notes ?? "";
  dom.decisionReason.setAttribute("aria-invalid", String(needsDetails && !record.reason));
  dom.decisionError.hidden = !(needsDetails && !record.reason);
  dom.decisionError.textContent = needsDetails && !record.reason ? "Zgjidh një arsye për ta ruajtur vendimin." : "";

  if (conflicted) {
    dom.decisionSavedAt.textContent = "Zgjidh versionin në disk ose versionin lokal";
  } else if (complete && record.reviewedAt) {
    dom.decisionSavedAt.textContent = `Vendosur më ${formatDateTime(record.reviewedAt)}`;
  } else if (record.verdict && hasCompleteDecision(record)) {
    dom.decisionSavedAt.textContent = "Vendimi mbetet lokalisht derisa të korrigjohen të dhënat";
  } else if (record.verdict) {
    dom.decisionSavedAt.textContent = "Vendimi pret arsyen";
  } else if (entriesDiffer(getActiveCandidate().entry, record.proposedEntry)) {
    dom.decisionSavedAt.textContent = "Ndryshimet janë ruajtur si skicë";
  } else {
    dom.decisionSavedAt.textContent = "Ende pa vendim";
  }
}

function renderUndoState() {
  dom.undoButton.disabled = state.undoStack.length === 0;
}

function setFilter(filter) {
  if (!["all", "pending", "attention"].includes(filter)) return;
  state.filter = filter;
  const entries = getFilteredEntries();
  if (!entries.some((candidate) => candidate.answerId === state.activeAnswerId)) {
    state.activeAnswerId = entries[0]?.answerId ?? null;
  }
  renderFilters();
  renderQueue();
  renderCandidate();
}

function selectCandidate(answerId, options = {}) {
  if (!state.entriesById.has(answerId)) return;
  state.activeAnswerId = answerId;
  renderQueue();
  renderCandidate();
  if (options.focus !== false) {
    requestAnimationFrame(() => dom.candidateWord.focus());
  }
  announce(`Fjala ${getActiveCandidate().entry.word}.`);
}

function navigate(direction) {
  const entries = getFilteredEntries();
  const index = entries.findIndex((candidate) => candidate.answerId === state.activeAnswerId);
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= entries.length) return;
  selectCandidate(entries[nextIndex].answerId);
}

function keepActiveCandidateVisible(previousAnswerId) {
  const filteredEntries = getFilteredEntries();
  if (filteredEntries.some((candidate) => candidate.answerId === state.activeAnswerId)) return false;
  if (filteredEntries.length === 0) {
    state.activeAnswerId = null;
  } else {
    const previousIndex = state.batchDocument.entries.findIndex(
      (candidate) => candidate.answerId === previousAnswerId,
    );
    state.activeAnswerId =
      filteredEntries.find(
        (candidate) =>
          state.batchDocument.entries.findIndex((item) => item.answerId === candidate.answerId) >
          previousIndex,
      )?.answerId ?? filteredEntries[0].answerId;
  }
  renderQueue();
  renderCandidate();
  return true;
}

function skipCandidate() {
  const currentWord = getActiveCandidate()?.entry.word;
  const next = findNextCandidateAfter(
    state.activeAnswerId,
    (candidate) => !isReviewComplete(getRecord(candidate.answerId)),
  );
  if (next) {
    selectCandidate(next.answerId);
    showToast(`${currentWord} u la pa vendim.`);
  } else {
    showToast("Nuk ka kandidatë të tjerë pa vendim.");
  }
}

function setVerdict(verdict, options = {}) {
  if (!ALLOWED_VERDICTS.has(verdict) || state.activeAnswerId === null) return false;
  const candidate = getActiveCandidate();
  const currentRecord = ensureRecord(candidate.answerId);

  if (verdict === "approve_daily") {
    const validationMessage = validateEntry(currentRecord.proposedEntry, candidate.answerId);
    if (validationMessage) {
      openEditPanel();
      showEntryValidation(validationMessage);
      showToast("Plotëso të dhënat para pranimit.", true);
      return false;
    }
  }

  if (currentRecord.verdict !== verdict) {
    pushUndoSnapshot(candidate.answerId, currentRecord);
  }

  const now = new Date().toISOString();
  const verdictChanged = currentRecord.verdict !== verdict;
  currentRecord.verdict = verdict;
  currentRecord.reviewedAt = now;
  currentRecord.updatedAt = now;
  markRecordDirty(candidate.answerId);
  if (verdictChanged || verdict === "approve_daily") {
    currentRecord.reason = "";
  }
  state.updatedAt = now;
  persistLocalBackup();
  renderProgress();
  renderFilters();
  renderQueue();
  renderDecision(currentRecord);
  renderUndoState();

  if (hasCompleteDecision(currentRecord)) {
    scheduleSave();
    if (isReviewComplete(currentRecord)) {
      announce(`${candidate.entry.word}: ${VERDICT_META[verdict].label}.`);
      const movedWithinFilter = keepActiveCandidateVisible(candidate.answerId);
      if (options.advance && !movedWithinFilter) {
        window.setTimeout(() => advanceAfterSwipe(candidate.answerId), 180);
      }
    } else {
      openEditPanel();
      showEntryValidation(validateEntry(currentRecord.proposedEntry, candidate.answerId));
      announce(`${candidate.entry.word}: vendimi mbetet lokalisht; korrigjo të dhënat.`);
    }
    } else {
      scheduleSave();
      setSaveStatus("local", "Zgjidh arsyen për ta ruajtur");
    requestAnimationFrame(() => dom.decisionReason.focus());
    announce(`${VERDICT_META[verdict].label}. Zgjidh një arsye.`);
  }
  return true;
}

function updateDecisionDetails(event) {
  const record = ensureRecord(state.activeAnswerId);
  const now = new Date().toISOString();
  record.reason = cleanText(dom.decisionReason.value);
  record.notes = dom.decisionNotes.value;
  record.updatedAt = now;
  markRecordDirty(record.answerId);
  if (record.verdict) record.reviewedAt = now;
  state.updatedAt = now;
  persistLocalBackup();
  renderProgress();
  renderFilters();
  renderQueue();
  if (event?.target !== dom.decisionNotes) renderDecision(record);

  if (hasCompleteDecision(record)) {
    scheduleSave();
    if (isReviewComplete(record)) keepActiveCandidateVisible(record.answerId);
  } else {
    scheduleSave();
    setSaveStatus("local", "Skica u ruajt lokalisht");
  }
}

function updateEditedField(field, value) {
  if (!EDITABLE_FIELDS.includes(field) || state.activeAnswerId === null) return;
  const candidate = getActiveCandidate();
  const record = ensureRecord(candidate.answerId);
  record.proposedEntry[field] = value;
  record.updatedAt = new Date().toISOString();
  markRecordDirty(record.answerId);
  state.updatedAt = record.updatedAt;
  if (dom.viewFields[field]) dom.viewFields[field].textContent = value || "—";
  dom.editFields[field].removeAttribute("aria-invalid");
  const validation = entryValidationMessage(record.proposedEntry, candidate.answerId);
  if (validation) {
    if (validation.field && dom.editFields[validation.field]) {
      dom.editFields[validation.field].setAttribute("aria-invalid", "true");
    }
    dom.entryValidation.textContent = validation.message;
    dom.entryValidation.hidden = false;
  } else {
    dom.entryValidation.hidden = true;
  }
  renderEditState(candidate, record);
  renderProgress();
  renderFilters();
  renderQueue();
  renderDecision(record);
  persistLocalBackup();
  if (!validation) {
    if (hasCompleteDecision(record)) record.reviewedAt = record.updatedAt;
    scheduleSave();
  } else {
    scheduleSave();
    setSaveStatus("local", "Skica lokale pret të dhëna të vlefshme");
  }
}

function resetCurrentEntry() {
  const candidate = getActiveCandidate();
  if (!candidate) return;
  const record = ensureRecord(candidate.answerId);
  record.proposedEntry = sanitizeEntry(candidate.entry, candidate.entry);
  record.updatedAt = new Date().toISOString();
  markRecordDirty(record.answerId);
  state.updatedAt = record.updatedAt;
  if (hasCompleteDecision(record)) record.reviewedAt = record.updatedAt;
  persistLocalBackup();
  renderAll();
  scheduleSave();
  showToast("Të dhënat origjinale u kthyen.");
}

function useDiskConflictVersion() {
  const answerId = state.activeAnswerId;
  if (!state.conflictedAnswerIds.has(answerId)) return;
  const localRecord = state.records.get(answerId);
  if (localRecord) pushUndoSnapshot(answerId, localRecord);
  const diskRecord = state.serverRecords.get(answerId);
  state.conflictedAnswerIds.delete(answerId);
  if (diskRecord) {
    state.records.set(answerId, clone(diskRecord));
  } else {
    state.records.delete(answerId);
  }
  refreshDirtyAnswerIds();
  state.updatedAt = new Date().toISOString();
  persistLocalBackup();
  renderAll();
  scheduleSave();
  showToast("U mbajt versioni në disk.");
}

function keepLocalConflictVersion() {
  const answerId = state.activeAnswerId;
  if (!state.conflictedAnswerIds.has(answerId)) return;
  const record = ensureRecord(answerId);
  const now = new Date().toISOString();
  state.conflictedAnswerIds.delete(answerId);
  record.updatedAt = now;
  if (record.verdict) record.reviewedAt = now;
  state.updatedAt = now;
  markRecordDirty(answerId);
  persistLocalBackup();
  renderAll();
  scheduleSave();
  showToast("U zgjodh versioni lokal dhe po ruhet.");
}

function toggleEditPanel() {
  const willOpen = dom.editPanel.hidden;
  dom.editPanel.hidden = !willOpen;
  dom.editToggle.setAttribute("aria-expanded", String(willOpen));
  if (willOpen) {
    requestAnimationFrame(() => dom.editFields.partOfSpeech.focus());
  }
}

function openEditPanel() {
  dom.editPanel.hidden = false;
  dom.editToggle.setAttribute("aria-expanded", "true");
}

function validateEntry(entry, answerId) {
  const validation = entryValidationMessage(entry, answerId);
  if (!validation) return "";
  if (validation.field && dom.editFields[validation.field]) {
    dom.editFields[validation.field].setAttribute("aria-invalid", "true");
  }
  return validation.message;
}

function entryValidationMessage(entry, answerId) {
  if (entry.id !== answerId) {
    return { field: null, message: `ID-ja e kandidatit duhet të mbetet ${answerId}.` };
  }
  const missingField = ENTRY_STRING_FIELDS.find((field) => !cleanText(entry[field]));
  if (missingField) {
    const labels = {
      word: "Fjala",
      partOfSpeech: "Lloji",
      syllables: "Rrokjet",
      clue: "Gjurma",
      definition: "Përkufizimi",
      example: "Shembulli",
      region: "Regjistri",
    };
    return { field: missingField, message: `${labels[missingField]} nuk mund të jetë bosh.` };
  }
  const oversizedField = ENTRY_STRING_FIELDS.find(
    (field) => String(entry[field]).length > ENTRY_STRING_LIMITS[field],
  );
  if (oversizedField) {
    return {
      field: oversizedField,
      message: `${oversizedField} tejkalon kufirin prej ${ENTRY_STRING_LIMITS[oversizedField]} shenjash.`,
    };
  }
  if (ENTRY_STRING_FIELDS.some((field) => entry[field] !== entry[field].normalize("NFC"))) {
    return { field: null, message: "Teksti duhet të përdorë normalizimin Unicode NFC." };
  }
  if (entry.word !== entry.word.toLocaleLowerCase("sq-AL")) {
    return { field: "word", message: "Fjala duhet të shkruhet me shkronja të vogla." };
  }
  if (tokenizeAlbanian(entry.word).length !== 5) {
    return {
      field: "word",
      message: "Fjala duhet të ketë pesë shkronja shqipe; dyshkronjëshat numërohen si një.",
    };
  }
  if (entry.syllables.replaceAll("-", "").toLocaleLowerCase("sq-AL") !== entry.word) {
    return { field: "syllables", message: "Rrokjet duhet ta riprodhojnë saktë fjalën pa viza." };
  }
  if (entry.region !== "standard") {
    return { field: "region", message: "Ky grup pranon vetëm regjistrin standard." };
  }
  return null;
}

function showEntryValidation(message) {
  dom.entryValidation.textContent = message;
  dom.entryValidation.hidden = false;
  const invalidInput = dom.entryForm.querySelector('[aria-invalid="true"]');
  requestAnimationFrame(() => invalidInput?.focus());
}

function pushUndoSnapshot(answerId, record) {
  state.undoStack.push({
    answerId,
    record: clone(record),
    conflicted: state.conflictedAnswerIds.has(answerId),
  });
  if (state.undoStack.length > 30) state.undoStack.shift();
}

function undoLastDecision() {
  const snapshot = state.undoStack.pop();
  if (!snapshot) return;
  state.records.set(snapshot.answerId, snapshot.record);
  if (snapshot.conflicted) {
    state.conflictedAnswerIds.add(snapshot.answerId);
  } else {
    state.conflictedAnswerIds.delete(snapshot.answerId);
  }
  refreshDirtyAnswerIds();
  state.updatedAt = new Date().toISOString();
  state.activeAnswerId = snapshot.answerId;
  persistLocalBackup();
  renderAll();
  scheduleSave();
  announce(`Vendimi për ${getActiveCandidate().entry.word} u zhbë.`);
  showToast("Vendimi i fundit u zhbë.");
}

function scheduleSave() {
  persistLocalBackup();
  window.clearTimeout(state.saveTimer);
  setSaveStatus("saving", "Ndryshime të paruajtura…");
  state.saveTimer = window.setTimeout(saveReviewToServer, 650);
}

async function saveReviewToServer() {
  window.clearTimeout(state.saveTimer);
  state.saveTimer = null;

  if (state.saveInFlight) {
    state.saveQueued = true;
    return;
  }

  state.saveInFlight = true;
  state.saveQueued = false;
  setSaveStatus("saving", "Duke ruajtur…");
  const saveSessionVersion = state.sessionVersion;
  const saveReviewerId = state.reviewerId;
  const payload = makeReviewPayload();
  const headers = { "Content-Type": "application/json" };
  if (state.serverEtag) {
    headers["If-Match"] = state.serverEtag;
  } else {
    headers["If-None-Match"] = "*";
  }
  let suppressQueuedSave = false;

  try {
    const response = await fetch(API.review, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const message = await readResponseError(response);
      const error = new Error(message || `Ruajtja dështoi (${response.status}).`);
      error.statusCode = response.status;
      throw error;
    }
    const result = await response.json();
    if (
      saveSessionVersion !== state.sessionVersion ||
      saveReviewerId !== state.reviewerId
    ) {
      return;
    }
    state.serverEtag = response.headers.get("ETag");
    state.serverRecords = recordsFromReview(payload);
    refreshDirtyAnswerIds();
    const savedAt = validTimestamp(result.savedAt ?? result.updatedAt) ?? new Date().toISOString();
    if (parseTimestamp(savedAt) > parseTimestamp(state.updatedAt)) {
      state.updatedAt = savedAt;
    }
    persistLocalBackup();
    const localOnlyRecords = getLocalOnlyRecords();
    if (state.conflictedAnswerIds.size > 0) {
      const conflictId = [...state.conflictedAnswerIds][0];
      const conflictWord = state.entriesById.get(conflictId)?.entry.word;
      setSaveStatus("error", `Konflikt${conflictWord ? ` te ${conflictWord}` : ""} · zgjidh versionin`);
    } else if (localOnlyRecords.length > 0) {
      const firstWord = state.entriesById.get(localOnlyRecords[0].answerId)?.entry.word;
      setSaveStatus(
        "local",
        `Ruajtur · ${localOnlyRecords.length} skicë lokale${firstWord ? ` (${firstWord})` : ""}`,
      );
    } else {
      setSaveStatus("saved", `Ruajtur më ${formatTime(savedAt)}`);
    }
  } catch (error) {
    if (
      saveSessionVersion !== state.sessionVersion ||
      saveReviewerId !== state.reviewerId
    ) {
      return;
    }
    persistLocalBackup();
    if (error.statusCode === 409) {
      try {
        const mergeResult = await mergeLatestServerReview(saveSessionVersion, saveReviewerId);
        if (mergeResult?.merged) {
          state.saveQueued = true;
          setSaveStatus("local", "U bashkua me ndryshimet nga skeda tjetër…");
          showToast("Ndryshimet e dy skedave u bashkuan dhe po ruhen sërish.");
        } else if (mergeResult?.conflictIds.length > 0) {
          suppressQueuedSave = true;
          const conflictWord = state.entriesById.get(mergeResult.conflictIds[0])?.entry.word;
          setSaveStatus("error", `Konflikt${conflictWord ? ` te ${conflictWord}` : ""} · zgjidh ndryshimin`);
          showToast(
            "I njëjti kandidat u ndryshua në dy skeda. Kopja lokale u ruajt; kontrolloje para ruajtjes tjetër.",
            true,
          );
        } else {
          suppressQueuedSave = true;
        }
      } catch (mergeError) {
        suppressQueuedSave = true;
        setSaveStatus("error", "Konflikt ruajtjeje · kopja lokale u ruajt");
        showToast(readableError(mergeError, "Ringarko ose shkarko JSON para se të vazhdosh."), true);
      }
    } else {
      setSaveStatus("error", "Serveri s’u arrit · kopja lokale u ruajt");
      showToast(readableError(error, "Ruajtja në server dështoi."), true);
    }
  } finally {
    state.saveInFlight = false;
    const sameSession =
      saveSessionVersion === state.sessionVersion && saveReviewerId === state.reviewerId;
    if (state.saveQueued && !(suppressQueuedSave && sameSession)) {
      state.saveQueued = false;
      void saveReviewToServer();
    }
  }
}

async function mergeLatestServerReview(sessionVersion, reviewerId) {
  const baseRecords = new Map(
    [...state.serverRecords].map(([answerId, record]) => [answerId, clone(record)]),
  );
  const latest = await fetchSavedReview(reviewerId);
  if (sessionVersion !== state.sessionVersion || reviewerId !== state.reviewerId) {
    return null;
  }
  const latestRecords = latest.review ? recordsFromReview(latest.review) : new Map();
  const { records: mergedRecords, conflictIds } = rebaseDirtyReviewRecords({
    baseRecords,
    latestRecords,
    currentRecords: state.records,
    dirtyAnswerIds: state.dirtyAnswerIds,
  });

  state.serverEtag = latest.etag;
  if (latest.review) {
    state.startedAt = validTimestamp(latest.review.startedAt) ?? state.startedAt;
    const latestUpdatedAt = validTimestamp(latest.review.updatedAt);
    if (latestUpdatedAt && parseTimestamp(latestUpdatedAt) > parseTimestamp(state.updatedAt)) {
      state.updatedAt = latestUpdatedAt;
    }
  }
  state.serverRecords = new Map(
    [...latestRecords].map(([answerId, record]) => [answerId, clone(record)]),
  );
  state.records = mergedRecords;
  refreshDirtyAnswerIds();
  for (const answerId of conflictIds) state.conflictedAnswerIds.add(answerId);
  if (conflictIds.length > 0) {
    state.activeAnswerId = conflictIds[0];
    openEditPanel();
  }
  persistLocalBackup();
  renderAll();
  return { merged: conflictIds.length === 0, conflictIds };
}

function makeReviewPayload() {
  const records = state.batchDocument.entries
    .map((candidate) =>
      state.conflictedAnswerIds.has(candidate.answerId)
        ? state.serverRecords.get(candidate.answerId) ?? null
        : getRecord(candidate.answerId),
    )
    .filter((record) => record && isRecordEntryValid(record));
  const decisions = records.filter(hasCompleteDecision).map(toDecisionPayload);
  const drafts = records.filter(isDraftRecord).map(toDraftPayload);

  return {
    schemaVersion: 1,
    kind: "fjale-editorial-review",
    batch: {
      id: state.batchDocument.batch.id,
      sourceCatalogSha256: state.batchDocument.batch.sourceCatalogSha256,
      answerIds: [...state.batchDocument.batch.answerIds],
    },
    reviewer: { id: state.reviewerId },
    decisions,
    drafts,
    startedAt: state.startedAt,
    updatedAt: state.updatedAt ?? new Date().toISOString(),
  };
}

function isRecordEntryValid(record) {
  return !entryValidationMessage(record.proposedEntry, record.answerId);
}

function getLocalOnlyRecords() {
  return state.batchDocument.entries
    .map((candidate) => getRecord(candidate.answerId))
    .filter(
      (record) =>
        record &&
        (Boolean(record.verdict) || isDraftRecord(record)) &&
        !isReviewComplete(record),
    );
}

function toDecisionPayload(record) {
  return {
    answerId: record.answerId,
    sourceSha256: record.sourceSha256,
    verdict: record.verdict,
    proposedEntry: sanitizeEntry(record.proposedEntry, {}),
    reason: record.verdict === "approve_daily" ? "" : record.reason,
    notes: record.notes.trim(),
    reviewedAt: record.reviewedAt,
  };
}

function toDraftPayload(record) {
  return {
    answerId: record.answerId,
    sourceSha256: record.sourceSha256,
    proposedEntry: sanitizeEntry(record.proposedEntry, {}),
    notes: record.notes.trim(),
    updatedAt: record.updatedAt,
  };
}

function persistLocalBackup() {
  if (!state.batchDocument || !state.reviewerId) return;
  try {
    writeReviewBackup(
      localStorage,
      localReviewKey(state.reviewerId),
      REVIEW_TAB_ID,
      JSON.stringify(makeLocalReviewPayload()),
    );
  } catch {
    setSaveStatus("error", "Kopja lokale nuk u ruajt");
  }
}

function makeLocalReviewPayload() {
  const payload = makeReviewPayload();
  payload.localRecords = [...state.records.values()].map((record) => clone(record));
  payload.baseRecords = [...state.serverRecords.values()].map((record) => clone(record));
  payload.baseEtag = state.serverEtag;
  payload.dirtyAnswerIds = [...state.dirtyAnswerIds];
  payload.conflictedAnswerIds = [...state.conflictedAnswerIds];
  return payload;
}

function readLocalReview(reviewerId) {
  const { selected } = refreshRecoveryBackups(reviewerId);
  if (!selected) return null;

  const review = clone(selected.review);
  if (Array.isArray(review.localRecords)) {
    review.drafts = review.localRecords;
    review.decisions = [];
  }
  return review;
}

function refreshRecoveryBackups(reviewerId) {
  const validCandidates = readMatchingLocalReviewCandidates(reviewerId);
  const selected =
    validCandidates.find(({ currentTab }) => currentTab) ??
    [...validCandidates].sort((left, right) => {
      const timestampDifference =
        parseTimestamp(right.review.updatedAt) - parseTimestamp(left.review.updatedAt);
      return timestampDifference || left.key.localeCompare(right.key, "en");
    })[0] ??
    null;
  state.recoveryBackups = validCandidates
    .filter((candidate) => candidate !== selected)
    .map(({ key, currentTab, sharedFallback, review }) => ({
      key,
      currentTab,
      sharedFallback,
      review: clone(review),
    }));
  renderBackupAvailability(selected ? 1 + state.recoveryBackups.length : 0);
  return { selected };
}

function readMatchingLocalReviewCandidates(reviewerId) {
  try {
    return readReviewBackupCandidates(
      localStorage,
      localReviewKey(reviewerId),
      REVIEW_TAB_ID,
    ).flatMap((candidate) => {
      try {
        const review = JSON.parse(candidate.serializedReview);
        return isMatchingLocalReview(review, reviewerId)
          ? [{ ...candidate, review }]
          : [];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

function handleReviewBackupStorageChange(event) {
  const storage = readLocalStorage();
  if (!state.batchDocument || !state.reviewerId || !storage || event.storageArea !== storage) return;
  const sharedKey = localReviewKey(state.reviewerId);
  if (event.key === sharedKey || event.key?.startsWith(`${sharedKey}:tab:`)) {
    refreshRecoveryBackups(state.reviewerId);
  }
}

function isMatchingLocalReview(review, reviewerId) {
  return (
    review?.batch?.id === state.batchDocument.batch.id &&
    review.batch.sourceCatalogSha256 === state.batchDocument.batch.sourceCatalogSha256 &&
    JSON.stringify(review.batch.answerIds) === JSON.stringify(state.batchDocument.batch.answerIds) &&
    review?.reviewer?.id === reviewerId
  );
}

function renderBackupAvailability(backupCount) {
  const hasAlternatives = backupCount > 1;
  dom.downloadButtonCopy.textContent = hasAlternatives
    ? `Shkarko JSON · ${backupCount} kopje`
    : "Shkarko JSON";
  dom.downloadButton.setAttribute(
    "aria-label",
    hasAlternatives
      ? `Shkarko rishikimin dhe ${backupCount - 1} kopje të tjera lokale si JSON`
      : "Shkarko rishikimin si JSON",
  );
  dom.downloadButton.title = hasAlternatives
    ? `${backupCount} variante lokale u gjetën; të gjitha përfshihen në shkarkim.`
    : "";
}

function downloadReview() {
  if (!state.batchDocument || !state.reviewerId) return;
  persistLocalBackup();
  refreshRecoveryBackups(state.reviewerId);
  const localReview = makeLocalReviewPayload();
  const payload = {
    schemaVersion: 1,
    kind: "fjale-editorial-backup",
    exportedAt: new Date().toISOString(),
    review: makeReviewPayload(),
    localRecords: localReview.localRecords,
    baseRecords: localReview.baseRecords,
    baseEtag: localReview.baseEtag,
    dirtyAnswerIds: localReview.dirtyAnswerIds,
    conflictedAnswerIds: localReview.conflictedAnswerIds,
    recoveryBackups: state.recoveryBackups.map(({ key, currentTab, sharedFallback, review }) => ({
      storageKey: key,
      currentTab,
      sharedFallback,
      review,
    })),
  };
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${safeFilePart(state.batchDocument.batch.id)}--${safeFilePart(state.reviewerId)}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  showToast("Kopja e plotë, përfshirë skicat lokale, u shkarkua si JSON.");
}

function changeReviewer() {
  persistLocalBackup();
  if (state.saveTimer) void saveReviewToServer();
  dom.reviewerInput.value = state.reviewerId;
  showOnly(dom.setupPanel);
  setSaveStatus("ready", "Zgjidh shqyrtuesin");
  requestAnimationFrame(() => dom.reviewerInput.focus());
}

async function loadReconciliation() {
  dom.reconciliationPanel.hidden = true;
  try {
    const response = await fetch(API.reconciliation, { cache: "no-store" });
    if (!response.ok) return;
    const documentValue = await response.json();
    const summary = documentValue.summary ?? documentValue;
    const reviewers = Array.isArray(documentValue.reviewers)
      ? documentValue.reviewers.length
      : pickNumber(summary, ["reviewers", "reviewerCount"]);
    const agreements = pickNumber(summary, ["approved", "agreements", "agreementCount", "matched"]);
    const practiceOnly = pickNumber(summary, ["practiceOnly"]);
    const rejected = pickNumber(summary, ["rejected"]);
    const needsRevision = pickNumber(summary, ["needsRevision"]);
    const conflicts = pickNumber(summary, ["conflict", "conflicts", "conflictCount", "needsReconciliation"]);
    const parts = [];
    if (reviewers !== null) parts.push(`${reviewers} shqyrtues`);
    if (agreements !== null) parts.push(`${agreements} për ditore`);
    if (practiceOnly) parts.push(`${practiceOnly} vetëm praktikë`);
    if (rejected) parts.push(`${rejected} të refuzuara`);
    if (needsRevision) parts.push(`${needsRevision} për korrigjim`);
    if (conflicts !== null) parts.push(`${conflicts} për t’u bashkërenduar`);
    if (parts.length === 0 && typeof summary.message === "string") parts.push(summary.message);
    if (parts.length === 0) return;
    dom.reconciliationCopy.textContent = parts.join(" · ");
    dom.reconciliationPanel.hidden = false;
  } catch {
    // Reconciliation is supplementary; review work remains fully usable without it.
  }
}

function handleKeyboardShortcut(event) {
  if (!state.batchDocument || dom.editorApp.hidden || isTypingTarget(event.target)) return;
  if (event.defaultPrevented || event.altKey || event.metaKey || event.ctrlKey) return;

  const key = event.key.toLowerCase();
  const actions = {
    a: () => setVerdict("approve_daily"),
    p: () => setVerdict("practice_only"),
    n: () => setVerdict("needs_revision"),
    r: () => setVerdict("reject_content"),
    s: skipCandidate,
    e: toggleEditPanel,
    arrowleft: () => navigate(-1),
    arrowright: () => navigate(1),
  };
  const action = actions[key];
  if (!action) return;
  event.preventDefault();
  action();
}

function startSwipe(event) {
  if (event.pointerType === "mouse" || isInteractiveTarget(event.target)) return;
  state.swipe = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    deltaX: 0,
    dragging: false,
  };
}

function moveSwipe(event) {
  const swipe = state.swipe;
  if (!swipe || swipe.pointerId !== event.pointerId) return;
  const deltaX = event.clientX - swipe.startX;
  const deltaY = event.clientY - swipe.startY;
  if (!swipe.dragging && (Math.abs(deltaX) < 10 || Math.abs(deltaX) <= Math.abs(deltaY))) return;
  swipe.dragging = true;
  swipe.deltaX = Math.max(-130, Math.min(130, deltaX));
  dom.candidateCard.classList.add("is-swiping");
  dom.candidateCard.style.transform = `translateX(${swipe.deltaX * 0.36}px)`;
  event.preventDefault();
}

function endSwipe(event) {
  const swipe = state.swipe;
  if (!swipe || swipe.pointerId !== event.pointerId) return;
  const deltaX = event.clientX - swipe.startX;
  const deltaY = event.clientY - swipe.startY;
  state.swipe = null;

  if (swipe.dragging && Math.abs(deltaX) >= 72 && Math.abs(deltaX) > Math.abs(deltaY) * 1.3) {
    const verdict = deltaX > 0 ? "approve_daily" : "needs_revision";
    const accepted = setVerdict(verdict, { advance: deltaX > 0 });
    if (accepted) {
      releaseSwipe(deltaX > 0 ? 1 : -1);
      return;
    }
  }
  resetSwipeTransform(true);
}

function cancelSwipe() {
  state.swipe = null;
  resetSwipeTransform(true);
}

function releaseSwipe(direction) {
  dom.candidateCard.classList.remove("is-swiping");
  dom.candidateCard.classList.add("is-releasing");
  dom.candidateCard.style.transform = `translateX(${direction * 34}px)`;
  window.setTimeout(() => resetSwipeTransform(true), 180);
}

function resetSwipeTransform(animate = false) {
  dom.candidateCard.classList.remove("is-swiping");
  dom.candidateCard.classList.toggle("is-releasing", animate);
  dom.candidateCard.style.transform = "translateX(0)";
  if (animate) {
    window.setTimeout(() => dom.candidateCard.classList.remove("is-releasing"), 190);
  }
}

function advanceAfterSwipe(answerId) {
  const next = findNextCandidateAfter(
    answerId,
    (candidate) => !isReviewComplete(getRecord(candidate.answerId)),
  );
  if (next) selectCandidate(next.answerId);
}

function findNextCandidateAfter(answerId, predicate) {
  const entries = state.batchDocument.entries;
  const currentIndex = entries.findIndex((candidate) => candidate.answerId === answerId);
  for (let offset = 1; offset < entries.length; offset += 1) {
    const candidate = entries[(currentIndex + offset) % entries.length];
    if (predicate(candidate)) return candidate;
  }
  return null;
}

function getFilteredEntries() {
  const entries = state.batchDocument?.entries ?? [];
  if (state.filter === "pending") {
    return entries.filter((candidate) => !isReviewComplete(getRecord(candidate.answerId)));
  }
  if (state.filter === "attention") {
    return entries.filter((candidate) => isAttentionRecord(getRecord(candidate.answerId)));
  }
  return entries;
}

function isAttentionRecord(record) {
  return Boolean(
    record &&
      (state.conflictedAnswerIds.has(record.answerId) ||
        !isRecordEntryValid(record) ||
        record.verdict === "needs_revision" ||
        record.verdict === "reject_content" ||
        (record.verdict && !hasCompleteDecision(record))),
  );
}

function getActiveCandidate() {
  return state.entriesById.get(state.activeAnswerId) ?? null;
}

function getRecord(answerId) {
  return state.records.get(answerId) ?? null;
}

function ensureRecord(answerId) {
  const existing = state.records.get(answerId);
  if (existing) return existing;
  const candidate = state.entriesById.get(answerId);
  const now = new Date().toISOString();
  const record = {
    answerId,
    sourceSha256: candidate.sourceSha256,
    verdict: null,
    proposedEntry: sanitizeEntry(candidate.entry, candidate.entry),
    reason: "",
    notes: "",
    reviewedAt: null,
    updatedAt: now,
  };
  state.records.set(answerId, record);
  return record;
}

function hasCompleteDecision(record) {
  if (!record || !ALLOWED_VERDICTS.has(record.verdict)) return false;
  if (record.verdict === "approve_daily") return record.reason === "";
  return Boolean(cleanText(record.reason));
}

function isReviewComplete(record) {
  return (
    hasCompleteDecision(record) &&
    isRecordEntryValid(record) &&
    !state.conflictedAnswerIds.has(record.answerId)
  );
}

function isDraftRecord(record) {
  if (!record) return false;
  const candidate = state.entriesById.get(record.answerId);
  if (!candidate) return false;
  return !hasCompleteDecision(record) && (entriesDiffer(candidate.entry, record.proposedEntry) || Boolean(record.notes));
}

function queueStateLabel(record) {
  if (!record) return "pa vendim";
  if (state.conflictedAnswerIds.has(record.answerId)) return "konflikt mes dy skedave";
  if (!isRecordEntryValid(record)) return "skicë e pavlefshme, vetëm lokale";
  if (!record.verdict) return isDraftRecord(record) ? "skicë pa vendim" : "pa vendim";
  if (!hasCompleteDecision(record)) return `${VERDICT_META[record.verdict].label}, mungon arsyeja`;
  return VERDICT_META[record.verdict].label;
}

function sanitizeEntry(value, fallback) {
  const source = value && typeof value === "object" ? value : {};
  const fallbackSource = fallback && typeof fallback === "object" ? fallback : {};
  return Object.fromEntries(
    ENTRY_FIELDS.map((field) => {
      if (field === "id") {
        const id = Number.isInteger(source.id) ? source.id : fallbackSource.id;
        return [field, Number.isInteger(id) ? id : null];
      }
      const raw = source[field] ?? fallbackSource[field] ?? "";
      return [field, typeof raw === "string" ? raw : String(raw)];
    }),
  );
}

function entriesDiffer(left, right) {
  return EDITABLE_FIELDS.some((field) => (left?.[field] ?? "") !== (right?.[field] ?? ""));
}

function tokenizeAlbanian(word) {
  const characters = Array.from(String(word ?? "").normalize("NFC").toLocaleUpperCase("sq-AL"));
  const tokens = [];
  for (let index = 0; index < characters.length; index += 1) {
    const pair = `${characters[index]}${characters[index + 1] ?? ""}`;
    if (ALBANIAN_DIGRAPHS.has(pair)) {
      tokens.push(pair);
      index += 1;
    } else if (/^[A-ZÇË]$/u.test(characters[index])) {
      tokens.push(characters[index]);
    } else {
      return [];
    }
  }
  return tokens;
}

function showOnly(panel) {
  [dom.loadingPanel, dom.errorPanel, dom.setupPanel, dom.editorApp].forEach((candidate) => {
    candidate.hidden = candidate !== panel;
  });
}

function showReviewerError(message) {
  dom.reviewerError.textContent = message;
  dom.reviewerError.hidden = false;
  dom.reviewerInput.setAttribute("aria-invalid", "true");
  dom.reviewerInput.focus();
}

function clearReviewerError() {
  dom.reviewerError.hidden = true;
  dom.reviewerInput.removeAttribute("aria-invalid");
}

function setSaveStatus(status, copy) {
  dom.saveStatus.dataset.state = status;
  dom.saveStatusCopy.textContent = copy;
}

function announce(message) {
  dom.liveRegion.textContent = "";
  window.setTimeout(() => {
    dom.liveRegion.textContent = message;
  }, 20);
}

function showToast(message, isError = false) {
  window.clearTimeout(state.toastTimer);
  dom.toast.textContent = message;
  dom.toast.classList.toggle("is-error", isError);
  dom.toast.hidden = false;
  state.toastTimer = window.setTimeout(() => {
    dom.toast.hidden = true;
  }, isError ? 5200 : 2800);
}

function scrollActiveQueueItemIntoView() {
  const active = dom.queueList.querySelector('[aria-current="true"]');
  const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  active?.scrollIntoView({ block: "nearest", inline: "nearest", behavior });
}

function normalizeReviewerId(value) {
  return String(value ?? "").trim().toLowerCase();
}

function localReviewKey(reviewerId) {
  return `${STORAGE_PREFIX}:${state.batchDocument.batch.id}:${reviewerId}`;
}

function createReviewTabId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function readSessionStorage() {
  try {
    return globalThis.sessionStorage;
  } catch {
    return null;
  }
}

function readLocalStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function readNavigatorLocks() {
  try {
    return globalThis.navigator?.locks ?? null;
  } catch {
    return null;
  }
}

function writeLocalValue(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // The reviewer form remains usable when storage is blocked.
  }
}

function readLocalValue(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function readableError(error, fallback) {
  if (error instanceof Error && cleanText(error.message)) return error.message;
  return fallback;
}

async function readResponseError(response) {
  try {
    const value = await response.json();
    return cleanText(value.error ?? value.message);
  } catch {
    return "";
  }
}

function clone(value) {
  return structuredClone(value);
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function shortHash(hash) {
  const cleanHash = String(hash ?? "").replace(/^sha256:/, "");
  return cleanHash ? cleanHash.slice(0, 8) : "—";
}

function safeFilePart(value) {
  return String(value ?? "review").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "");
}

function validTimestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}

function parseTimestamp(value) {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("sq-AL", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatTime(value) {
  return new Intl.DateTimeFormat("sq-AL", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function toKebabCase(value) {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function isTypingTarget(target) {
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

function isInteractiveTarget(target) {
  return Boolean(target.closest("button, a, input, textarea, select, summary, label"));
}

function pickNumber(objectValue, keys) {
  for (const key of keys) {
    const value = objectValue?.[key];
    if (Number.isFinite(value)) return value;
  }
  return null;
}
