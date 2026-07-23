import {
  ALBANIAN_ALPHABET,
  ALBANIAN_DIGRAPHS,
  COMPLETED_PUZZLES_CAP,
  applyCompletedGameToProfile,
  appendPhysicalCharacter,
  createChallengeCode,
  decodeChallengeCode,
  evaluateGuess,
  formatDuration,
  formatHintMetadata,
  getActiveDailyEpoch,
  getAttemptCount,
  getDailyAnswerIndex,
  getTiranaDateKey,
  mergePhysicalCharacterAt,
  normalizeWord,
  removeGuessTokenAt,
  removeLastToken,
  replaceGuessToken,
  sanitizeDailyResults,
  sanitizeModeStats,
  sanitizeReportedWords,
  sanitizeWordRatings,
  secondsUntilNextTiranaDay,
  tokenizeAlbanian,
  WORD_RATING_VALUES,
} from "./game.js";
import { ACCEPTED_GUESSES, ANSWERS, getAnswerById } from "./words.js";
import { REPORT_EMAIL } from "./config.js";

const ROW_COUNT = 6;
const COLUMN_COUNT = 5;
const HINT_UNLOCK_GUESS = 3;
// The published daily pool is immutable per epoch. Its size has a single source
// of truth — the active entry in DAILY_EPOCHS — so it can never drift from the
// rotation math. Growing the pool means appending a new epoch, never editing
// this value. New words may still be appended for practice meanwhile.
const DAILY_POOL_SIZE = getActiveDailyEpoch(new Date()).poolSize;
// The archive opens on launch day; earlier dates never had a published daily
// word, so they stay inert in the calendar.
const ARCHIVE_EPOCH = "2026-07-16";
const STORAGE_VERSION = 1;
const PROFILE_KEY = "fjale:profile:v1";
const PREFERENCES_KEY = "fjale:preferences:v1";
const PRACTICE_KEY = "fjale:game:practice";
const STATUS_RANK = Object.freeze({ absent: 1, present: 2, correct: 3 });
const STATUS_MARK = Object.freeze({ absent: "×", present: "•", correct: "✓" });
const STATUS_LABEL = Object.freeze({
  absent: "nuk është në fjalë",
  present: "është në fjalë, por diku tjetër",
  correct: "është në vendin e saktë",
});
const SHARE_MARK = Object.freeze({ absent: "×", present: "•", correct: "✓" });
// Human-facing Albanian labels for the persisted rating keys, in display order.
const WORD_RATING_LABELS = Object.freeze({
  e_drejte: "E drejtë",
  e_veshtire_por_e_drejte: "E vështirë, por e drejtë",
  e_rralle: "E rrallë",
  nuk_e_njihja: "Nuk e njihja",
  ka_gabim: "Ka një gabim",
});
const DIGRAPH_SET = new Set(ALBANIAN_DIGRAPHS);
const ALPHABET_SET = new Set(ALBANIAN_ALPHABET);
const ANSWER_SET = new Set(ANSWERS.map((entry) => entry.word));
const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)");

// Keep the ordinary keys in the familiar Albanian QWERTZ order. W and
// punctuation are omitted because guesses use exactly the 36 letters of the
// Albanian alphabet; the nine atomic digraphs have their own final row.
const KEYBOARD_ROWS = Object.freeze([
  ["q", "e", "r", "t", "z", "u", "i", "o", "p", "ç"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l", "ë"],
  ["y", "x", "c", "v", "b", "n", "m", "backspace"],
  ["dh", "gj", "ll", "nj", "rr", "sh", "th", "xh", "zh", "enter"],
]);

const ALBANIAN_MONTHS_SHORT = Object.freeze([
  "jan",
  "shk",
  "mar",
  "pri",
  "maj",
  "qer",
  "korr",
  "gush",
  "sht",
  "tet",
  "nën",
  "dhj",
]);

const ALBANIAN_MONTHS_LONG = Object.freeze([
  "janar",
  "shkurt",
  "mars",
  "prill",
  "maj",
  "qershor",
  "korrik",
  "gusht",
  "shtator",
  "tetor",
  "nëntor",
  "dhjetor",
]);

// Monday-first weekday names for the calendar header.
const ALBANIAN_WEEKDAYS_SHORT = Object.freeze([
  "Hën",
  "Mar",
  "Mër",
  "Enj",
  "Pre",
  "Sht",
  "Die",
]);

const ALBANIAN_WEEKDAYS_LONG = Object.freeze([
  "e hënë",
  "e martë",
  "e mërkurë",
  "e enjte",
  "e premte",
  "e shtunë",
  "e diel",
]);

const elements = {
  alphabetGrid: document.querySelector("#alphabet-grid"),
  besaButton: document.querySelector("#besa-button"),
  besaCard: document.querySelector("#besa-card"),
  besaDescription: document.querySelector("#besa-description"),
  board: document.querySelector("#board"),
  boardMessage: document.querySelector("#board-message"),
  boardReport: document.querySelector("#board-report"),
  boardStage: document.querySelector("#game-board"),
  calendarBody: document.querySelector("#calendar-body"),
  calendarHead: document.querySelector("#calendar-head"),
  calendarNext: document.querySelector("#calendar-next"),
  calendarPrev: document.querySelector("#calendar-prev"),
  calendarTitle: document.querySelector("#calendar-title"),
  challengeButton: document.querySelector("#challenge-button"),
  celebration: document.querySelector("#celebration"),
  contrastToggle: document.querySelector("#contrast-toggle"),
  dailyDate: document.querySelector("#daily-date"),
  dailyMode: document.querySelector("#daily-mode"),
  distribution: document.querySelector("#distribution"),
  headerProgress: document.querySelector("#header-progress"),
  hintBadge: document.querySelector("#hint-badge"),
  hintButton: document.querySelector("#hint-button"),
  hintCancel: document.querySelector("#hint-cancel"),
  hintCard: document.querySelector("#hint-card"),
  hintConfirm: document.querySelector("#hint-confirm"),
  hintConfirmation: document.querySelector("#hint-confirmation"),
  hintConfirmationCopy: document.querySelector("#hint-confirmation-copy"),
  hintCopy: document.querySelector("#hint-copy"),
  hintDescription: document.querySelector("#hint-description"),
  keyboard: document.querySelector("#keyboard"),
  passportCopy: document.querySelector("#passport-copy"),
  passportButton: document.querySelector(".passport-button"),
  passportCount: document.querySelector("#passport-count"),
  passportDialogCount: document.querySelector("#passport-dialog-count"),
  passportRing: document.querySelector("#passport-ring"),
  passportTip: document.querySelector("#passport-tip"),
  practiceMode: document.querySelector("#practice-mode"),
  puzzleInstruction: document.querySelector("#puzzle-instruction"),
  puzzleKicker: document.querySelector("#puzzle-kicker"),
  rareLetterRow: document.querySelector("#rare-letter-row"),
  replayButton: document.querySelector("#replay-button"),
  resultDefinition: document.querySelector("#result-definition"),
  resultExample: document.querySelector("#result-example"),
  resultCountdown: document.querySelector("#result-countdown"),
  resultBesaSeal: document.querySelector("#result-besa-seal"),
  resultLabel: document.querySelector("#result-label"),
  resultMeta: document.querySelector("#result-meta"),
  resultPanel: document.querySelector("#result-panel"),
  resultTime: document.querySelector("#result-time"),
  resultWord: document.querySelector("#result-word"),
  screenReaderStatus: document.querySelector("#screen-reader-status"),
  shareButton: document.querySelector("#share-button"),
  soundToggle: document.querySelector("#sound-toggle"),
  statArchivePlayed: document.querySelector("#stat-archive-played"),
  statArchiveWon: document.querySelector("#stat-archive-won"),
  statBesa: document.querySelector("#stat-besa"),
  statBest: document.querySelector("#stat-best"),
  statChallengeCount: document.querySelector("#stat-challenge-count"),
  statChallengeLine: document.querySelector("#stats-challenge"),
  statDailyPlayed: document.querySelector("#stat-daily-played"),
  statDailyWinRate: document.querySelector("#stat-daily-win-rate"),
  statDailyWon: document.querySelector("#stat-daily-won"),
  dailyDistribution: document.querySelector("#daily-distribution"),
  statPlayed: document.querySelector("#stat-played"),
  statPracticePlayed: document.querySelector("#stat-practice-played"),
  statPracticeWon: document.querySelector("#stat-practice-won"),
  statStreak: document.querySelector("#stat-streak"),
  statWinRate: document.querySelector("#stat-win-rate"),
  themeSelect: document.querySelector("#theme-select"),
  toast: document.querySelector("#toast"),
  updateBanner: document.querySelector("#update-banner"),
  updateDismiss: document.querySelector("#update-dismiss"),
  updateRefresh: document.querySelector("#update-refresh"),
  wordRating: document.querySelector("#word-rating"),
};

let preferences = loadPreferences();
let profile = loadProfile();
let primaryDescriptor = createPrimaryDescriptor();
let state = loadGame(primaryDescriptor);
let animatingRow = null;
let isAnimating = false;
let invalidPulse = false;
let hintConfirmationOpen = false;
let toastTimer = null;
let invalidTimer = null;
let revealTimer = null;
let countdownTimer = null;
let calendarView = null;
let audioContext = null;
// Service-worker update prompt state. The armed flag guarantees only an
// accepted prompt can reload the page: clients.claim() fires controllerchange
// on the very first install too, and that must never interrupt a game.
let updateRegistration = null;
let updateReloadArmed = false;
// Set when a game concludes live in this session, so the post-game rating row
// appears only for a genuine completion — never on reload of a game that
// finished before ratings existed, or in a previous session without a rating.
let justCompletedPuzzleId = null;
// Current-row editing is deliberately transient: it is an interaction cursor,
// not saved game data. The pending index lets a physical S then H still become
// one SH token after replacing a tile in a full row.
let selectedCurrentIndex = null;
let pendingEditedDigraphIndex = null;

if (ANSWERS.length < DAILY_POOL_SIZE) {
  throw new Error(`Daily pool requires at least ${DAILY_POOL_SIZE} answers.`);
}

initialize();

function initialize() {
  normalizeExpiredStreak();
  applyPreferences();
  wireInteractions();

  if (state.status !== "playing") {
    recordCompletedGame();
  }

  renderAll();
  registerServiceWorker();

  if (primaryDescriptor.invalidChallengeCode) {
    showToast(
      "Lidhja e sfidës nuk është e vlefshme. U hap fjala e ditës.",
      "Lidhja e sfidës nuk është e vlefshme, prandaj u hap fjala e ditës.",
    );
  }

  // Browsers may restore the previous scroll position after a reload. For a
  // completed puzzle, realign the primary result after that restoration
  // so the sticky header cannot cover its first line.
  if (state.status !== "playing") {
    const alignRestoredResult = () => {
      window.requestAnimationFrame(() => {
        if (state.status !== "playing") {
          elements.resultPanel.scrollIntoView({
            block: "start",
            behavior: "auto",
          });
        }
      });
    };

    if (document.readyState === "complete") {
      alignRestoredResult();
    } else {
      window.addEventListener("load", alignRestoredResult, { once: true });
    }
  }

  Object.defineProperty(window, "__FJALE__", {
    configurable: false,
    value: Object.freeze({
      getState: () => structuredClone(state),
      getProfile: () => structuredClone(profile),
      newPractice: () => startNewPractice(),
    }),
  });
}

function createPrimaryDescriptor() {
  const challengeCode = new URLSearchParams(window.location.search).get("sfida");
  // decodeChallengeCode resolves the code to an immutable answer id, which is
  // carried through as answerIndex (today equal to the array position) and
  // resolved via getAnswerById at play time.
  const challengeId = challengeCode
    ? decodeChallengeCode(challengeCode, ANSWERS.length)
    : null;

  if (challengeId !== null) {
    const canonicalCode = createChallengeCode(challengeId);
    return {
      mode: "challenge",
      answerIndex: challengeId,
      puzzleId: `challenge-${canonicalCode}`,
      challengeCode: canonicalCode,
    };
  }

  const now = new Date();
  const dateKey = getTiranaDateKey(now);
  return {
    mode: "daily",
    answerIndex: getDailyAnswerIndex(now),
    puzzleId: `daily-${dateKey}`,
    dateKey,
    // A ?sfida= code that fails to decode falls back to the daily word, but
    // silently swallowing the broken link would leave the recipient thinking
    // they are playing their friend's challenge. initialize() surfaces this.
    invalidChallengeCode: Boolean(challengeCode),
  };
}

function createArchiveDescriptor(dateKey) {
  // Noon UTC always resolves to the same Tirana calendar date, so the archive
  // word matches the daily word that was published on that date.
  const date = new Date(`${dateKey}T12:00:00Z`);
  return {
    mode: "archive",
    answerIndex: getDailyAnswerIndex(date),
    puzzleId: `archive-${dateKey}`,
    dateKey,
  };
}

function createGame(descriptor) {
  return {
    version: STORAGE_VERSION,
    mode: descriptor.mode,
    answerIndex: descriptor.answerIndex,
    puzzleId: descriptor.puzzleId,
    guesses: [],
    current: [],
    status: "playing",
    startedAt: null,
    completedAt: null,
    usedHint: false,
    hintRow: null,
    besa: false,
    recorded: false,
  };
}

function loadGame(descriptor) {
  const raw = readStorage(gameStorageKey(descriptor.mode, descriptor.puzzleId));
  return hydrateGame(raw, descriptor) ?? createGame(descriptor);
}

function loadOrCreatePractice() {
  const raw = readStorage(PRACTICE_KEY);
  const hydrated = hydrateGame(raw);

  if (hydrated?.mode === "practice" && hydrated.status === "playing") {
    return hydrated;
  }

  return createPracticeGame();
}

function createPracticeGame() {
  const answerIndex = randomAnswerIndex(state?.answerIndex);
  const code = createChallengeCode(answerIndex);
  return createGame({
    mode: "practice",
    answerIndex,
    puzzleId: `practice-${code}-${Date.now().toString(36)}`,
  });
}

function hydrateGame(raw, expectedDescriptor = null) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const answerIndex = Number(raw.answerIndex);
  const mode = raw.mode;
  const puzzleId = raw.puzzleId;

  if (
    !Number.isInteger(answerIndex) ||
    getAnswerById(answerIndex) === undefined ||
    !["daily", "practice", "challenge", "archive"].includes(mode) ||
    typeof puzzleId !== "string" ||
    puzzleId.length > 100
  ) {
    return null;
  }

  if (
    expectedDescriptor &&
    (expectedDescriptor.mode !== mode ||
      expectedDescriptor.answerIndex !== answerIndex ||
      expectedDescriptor.puzzleId !== puzzleId)
  ) {
    return null;
  }

  const candidateGuesses = Array.isArray(raw.guesses)
    ? raw.guesses.slice(0, ROW_COUNT).map(validateTokenRow).filter(Boolean)
    : [];
  const current = validateCurrentRow(raw.current);
  const answerTokens = tokenizeAlbanian(getAnswerById(answerIndex).word);
  const candidateWinningIndex = candidateGuesses.findIndex((guess) =>
    tokensEqual(guess, answerTokens),
  );
  let normalizedGuesses =
    candidateWinningIndex >= 0
      ? candidateGuesses.slice(0, candidateWinningIndex + 1)
      : candidateGuesses;
  const usedHint = Boolean(raw.usedHint);
  const candidateHintRow =
    usedHint &&
    Number.isInteger(raw.hintRow) &&
    raw.hintRow >= HINT_UNLOCK_GUESS &&
    raw.hintRow < ROW_COUNT - 1 &&
    raw.hintRow <= normalizedGuesses.length
      ? raw.hintRow
      : null;

  if (candidateHintRow !== null) {
    normalizedGuesses = normalizedGuesses.slice(0, ROW_COUNT - 1);
  }

  const winningIndex = normalizedGuesses.findIndex((guess) => tokensEqual(guess, answerTokens));
  const hintRow = winningIndex >= 0 && candidateHintRow > winningIndex ? null : candidateHintRow;
  const attemptCount = getAttemptCount(normalizedGuesses.length, hintRow !== null);
  const status = winningIndex >= 0 ? "won" : attemptCount >= ROW_COUNT ? "lost" : "playing";

  return {
    version: STORAGE_VERSION,
    mode,
    answerIndex,
    puzzleId,
    guesses: normalizedGuesses,
    current: status === "playing" ? current : [],
    status,
    startedAt: isSafeTimestamp(raw.startedAt) ? raw.startedAt : null,
    completedAt: status !== "playing" && isSafeTimestamp(raw.completedAt) ? raw.completedAt : null,
    usedHint,
    hintRow,
    besa: Boolean(raw.besa) && !usedHint,
    recorded: Boolean(raw.recorded),
  };
}

function validateTokenRow(row) {
  if (!Array.isArray(row) || row.length !== COLUMN_COUNT) {
    return null;
  }

  const normalized = row.map(normalizeWord);
  return normalized.every((token) => ALPHABET_SET.has(token)) ? normalized : null;
}

function validateCurrentRow(row) {
  if (!Array.isArray(row) || row.length > COLUMN_COUNT) {
    return [];
  }

  const normalized = row.map(normalizeWord);
  return normalized.every((token) => ALPHABET_SET.has(token)) ? normalized : [];
}

function wireInteractions() {
  elements.dailyMode.addEventListener("click", switchToPrimaryGame);
  elements.practiceMode.addEventListener("click", () => switchToPracticeGame());
  elements.hintButton.addEventListener("click", requestHint);
  elements.hintConfirm.addEventListener("click", revealHint);
  elements.hintCancel.addEventListener("click", () => closeHintConfirmation(true));
  elements.besaButton.addEventListener("click", toggleBesa);
  elements.board.addEventListener("click", handleBoardClick);
  elements.board.addEventListener("keydown", handleBoardKeydown);
  elements.keyboard.addEventListener("click", handleKeyboardClick);
  elements.shareButton.addEventListener("click", shareResult);
  elements.challengeButton.addEventListener("click", shareChallenge);
  elements.replayButton.addEventListener("click", startNewPractice);
  elements.updateRefresh.addEventListener("click", acceptUpdate);
  elements.updateDismiss.addEventListener("click", () => {
    elements.updateBanner.hidden = true;
  });
  elements.calendarPrev.addEventListener("click", () => shiftCalendar(-1));
  elements.calendarNext.addEventListener("click", () => shiftCalendar(1));
  elements.calendarBody.addEventListener("click", handleCalendarClick);
  document.addEventListener("keydown", handlePhysicalKeyboard);
  document.addEventListener(
    "pointerdown",
    () => {
      pendingEditedDigraphIndex = null;
    },
    { passive: true },
  );
  window.addEventListener("storage", handleStorageChange);

  document.querySelectorAll("[data-open-dialog]").forEach((button) => {
    button.addEventListener("click", () => openDialog(button.dataset.openDialog));
  });

  document.querySelectorAll("[data-close-dialog]").forEach((button) => {
    button.addEventListener("click", () => button.closest("dialog")?.close());
  });

  document.querySelectorAll("dialog").forEach((dialog) => {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) {
        dialog.close();
      }
    });
  });

  elements.themeSelect.addEventListener("change", () => {
    preferences.theme = elements.themeSelect.value;
    savePreferences();
    applyPreferences();
  });

  elements.contrastToggle.addEventListener("change", () => {
    preferences.contrast = elements.contrastToggle.checked;
    savePreferences();
    applyPreferences();
  });

  elements.soundToggle.addEventListener("change", () => {
    preferences.sound = elements.soundToggle.checked;
    savePreferences();
    if (preferences.sound) {
      playSound("key");
    }
  });

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (preferences.theme === "system") {
      updateThemeColor();
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.mode === "daily") {
      ensureCurrentDailyPuzzle();
    }
  });

  window.setInterval(() => {
    if (state.mode === "daily") {
      ensureCurrentDailyPuzzle();
    }
  }, 30_000);
}

function ensurePrimaryDescriptorIsCurrent() {
  if (
    primaryDescriptor.mode === "daily" &&
    primaryDescriptor.dateKey !== getTiranaDateKey()
  ) {
    window.location.reload();
    return false;
  }

  return true;
}

function ensureCurrentDailyPuzzle() {
  return state.mode !== "daily" || ensurePrimaryDescriptorIsCurrent();
}

function handleStorageChange(event) {
  if (event.key === PREFERENCES_KEY) {
    preferences = loadPreferences();
    applyPreferences();
    return;
  }

  if (event.key === PROFILE_KEY) {
    profile = loadProfile();
    renderPassport();
    renderStats();
    return;
  }

  const currentStorageKey = gameStorageKey(state.mode, state.puzzleId);
  if (event.key !== currentStorageKey || event.newValue === null) {
    return;
  }

  const remoteState = hydrateGame(readStorage(currentStorageKey), {
    mode: state.mode,
    answerIndex: state.answerIndex,
    puzzleId: state.puzzleId,
  });
  if (!remoteState || gameProgress(remoteState) <= gameProgress(state)) {
    return;
  }

  const submittedElsewhere = remoteState.guesses.length > state.guesses.length;
  const completedElsewhere = remoteState.status !== "playing" && state.status === "playing";
  const hintOpenedElsewhere = remoteState.usedHint && !state.usedHint;
  clearTransientState();
  state = remoteState;
  if (state.status !== "playing") {
    recordCompletedGame();
  }
  renderAll();

  if (completedElsewhere) {
    elements.resultPanel.focus({ preventScroll: true });
    announce("Loja u përfundua në një skedë tjetër.");
  } else if (submittedElsewhere) {
    announce("Loja u përditësua nga një skedë tjetër.");
  } else if (hintOpenedElsewhere) {
    announce("Gjurmë u hap në një skedë tjetër.");
  }
}

function gameProgress(game) {
  const completion = game.status === "playing" ? 0 : 1_000;
  const usedAttemptForHint = Number.isInteger(game.hintRow);
  const attempts = getAttemptCount(game.guesses.length, usedAttemptForHint);
  const flags = Number(game.besa) + Number(game.usedHint) + Number(usedAttemptForHint);
  return completion + attempts * 100 + game.current.length * 2 + flags;
}

function switchToPrimaryGame() {
  if (!ensurePrimaryDescriptorIsCurrent()) {
    return;
  }

  if (state.mode !== "practice" && state.mode !== "archive") {
    return;
  }

  persistGame();
  clearTransientState();
  state = loadGame(primaryDescriptor);
  if (state.status !== "playing") {
    recordCompletedGame();
  }
  renderAll();
  announce(primaryDescriptor.mode === "challenge" ? "U hap sfida." : "U hap fjala e ditës.");
}

function startArchiveGame(dateKey) {
  if (!isArchivableDate(dateKey)) {
    return;
  }

  persistGame();
  clearTransientState();
  state = loadGame(createArchiveDescriptor(dateKey));
  if (state.status !== "playing") {
    recordCompletedGame();
  }
  persistGame();
  document.querySelector("#stats-dialog")?.close();
  renderAll();
  window.scrollTo({ top: 0, behavior: REDUCED_MOTION.matches ? "auto" : "smooth" });
  announce(`U hap fjala e ${formatFullDate(dateKey)} nga arkiva.`);
}

// Archivable = published on or after launch, and already concluded (up to
// yesterday). Today is played from the main board, not the archive.
function isArchivableDate(dateKey) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(dateKey) &&
    dateKey >= ARCHIVE_EPOCH &&
    dateKey < getTiranaDateKey()
  );
}

function switchToPracticeGame(forceNew = false) {
  if (state.mode === "practice" && !forceNew) {
    return;
  }

  persistGame();
  clearTransientState();
  state = forceNew ? createPracticeGame() : loadOrCreatePractice();
  persistGame();
  renderAll();
  announce("U hap loja pa fund.");
}

function startNewPractice() {
  switchToPracticeGame(true);
  window.scrollTo({ top: 0, behavior: REDUCED_MOTION.matches ? "auto" : "smooth" });
}

function clearTransientState() {
  window.clearTimeout(revealTimer);
  window.clearTimeout(invalidTimer);
  closeHintConfirmation(false);
  animatingRow = null;
  isAnimating = false;
  invalidPulse = false;
  selectedCurrentIndex = null;
  pendingEditedDigraphIndex = null;
}

function handleBoardClick(event) {
  const tile = event.target.closest("[data-current-index]");
  if (!tile || !elements.board.contains(tile)) {
    return;
  }

  selectCurrentTile(Number(tile.dataset.currentIndex));
}

function handleBoardKeydown(event) {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }

  const tile = event.target.closest("[data-current-index]");
  if (!tile || !elements.board.contains(tile)) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  selectCurrentTile(Number(tile.dataset.currentIndex), true);
}

function getSelectedCurrentIndex() {
  return Number.isInteger(selectedCurrentIndex) &&
    selectedCurrentIndex >= 0 &&
    selectedCurrentIndex < state.current.length
    ? selectedCurrentIndex
    : null;
}

function selectCurrentTile(index, restoreFocus = false) {
  if (
    state.status !== "playing" ||
    isAnimating ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= state.current.length
  ) {
    return;
  }

  selectedCurrentIndex = index;
  pendingEditedDigraphIndex = null;
  const rowNumber = getStateAttemptCount() + 1;

  for (const tile of elements.board.querySelectorAll("[data-current-index]")) {
    const selected = Number(tile.dataset.currentIndex) === index;
    tile.classList.toggle("is-selected", selected);
    tile.setAttribute("aria-selected", String(selected));
    const token = state.current[Number(tile.dataset.currentIndex)];
    tile.setAttribute(
      "aria-label",
      selected
        ? `Rreshti ${rowNumber}, kutia ${index + 1}: ${token.toLocaleUpperCase("sq-AL")}, e zgjedhur për zëvendësim`
        : `Rreshti ${rowNumber}, kutia ${Number(tile.dataset.currentIndex) + 1}: ${token.toLocaleUpperCase("sq-AL")}. Zgjidhe për ta zëvendësuar`,
    );
  }

  if (restoreFocus) {
    elements.board.querySelector(`[data-current-index="${index}"]`)?.focus({
      preventScroll: true,
    });
  }

  announce(
    `Kutia ${index + 1}, ${state.current[index].toLocaleUpperCase("sq-AL")}, u zgjodh. Shkruaj shkronjën e re.`,
  );
}

function handleKeyboardClick(event) {
  const key = event.target.closest("button[data-key]");
  if (!key) {
    return;
  }

  const value = key.dataset.key;
  key.classList.add("is-pressed");
  window.setTimeout(() => key.classList.remove("is-pressed"), 90);

  if (value === "enter") {
    pendingEditedDigraphIndex = null;
    submitGuess();
  } else if (value === "backspace") {
    removeLetter();
  } else {
    inputLetter(value);
  }
}

function handlePhysicalKeyboard(event) {
  const isLetterKey = /^[a-zçë]$/iu.test(event.key);
  const hasOpenDialog = Boolean(document.querySelector("dialog[open]"));
  const hasTextInputTarget = ["INPUT", "SELECT", "TEXTAREA"].includes(
    event.target?.tagName,
  );
  const gameplayInputBlocked =
    event.defaultPrevented ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    hasOpenDialog ||
    hasTextInputTarget;
  if (
    gameplayInputBlocked ||
    (!isLetterKey && event.key !== "Shift" && event.key !== "CapsLock")
  ) {
    pendingEditedDigraphIndex = null;
  }

  if (gameplayInputBlocked) {
    return;
  }

  if (hintConfirmationOpen && event.key === "Escape") {
    event.preventDefault();
    closeHintConfirmation(true);
    return;
  }

  if (event.target.closest?.("#hint-confirmation")) {
    return;
  }

  if (hintConfirmationOpen) {
    if (event.key === "Tab") {
      return;
    }
    closeHintConfirmation(false);
  }

  if (event.key === "Enter") {
    event.preventDefault();
    submitGuess();
    return;
  }

  if (event.key === "Backspace" || event.key === "Delete") {
    event.preventDefault();
    removeLetter();
    return;
  }

  if (isLetterKey) {
    event.preventDefault();
    inputLetter(event.key, { fromPhysicalKeyboard: true });
  }
}

function inputLetter(letter, { fromPhysicalKeyboard = false } = {}) {
  if (!ensureCurrentDailyPuzzle() || state.status !== "playing" || isAnimating) {
    return;
  }

  closeHintConfirmation(false);

  // Any input attempt after a rejection dismisses the report link for that word,
  // even a no-op keypress on an already-full row.
  hideReportLink();

  const before = state.current;
  const normalized = normalizeWord(letter);
  const selectedIndex = getSelectedCurrentIndex();

  if (selectedIndex !== null && ALPHABET_SET.has(normalized)) {
    const returnFocusToBoard = document.activeElement?.matches?.(
      `[data-current-index="${selectedIndex}"]`,
    );
    state.current = replaceGuessToken(before, selectedIndex, normalized);
    selectedCurrentIndex = null;
    pendingEditedDigraphIndex =
      fromPhysicalKeyboard && !DIGRAPH_SET.has(normalized) ? selectedIndex : null;
    state.startedAt ??= Date.now();
    persistGame();
    resetBoardMessage();
    renderBoard();
    if (returnFocusToBoard) {
      elements.boardStage.focus({ preventScroll: true });
    }
    playSound("key");
    announce(
      `Kutia ${selectedIndex + 1} u zëvendësua me ${normalized.toLocaleUpperCase("sq-AL")}.`,
    );
    return;
  }

  if (
    fromPhysicalKeyboard &&
    Number.isInteger(pendingEditedDigraphIndex) &&
    pendingEditedDigraphIndex >= 0 &&
    pendingEditedDigraphIndex < before.length &&
    !DIGRAPH_SET.has(normalized)
  ) {
    const editedIndex = pendingEditedDigraphIndex;
    const returnFocusToBoard = document.activeElement?.matches?.(
      `[data-current-index="${editedIndex}"]`,
    );
    const merged = mergePhysicalCharacterAt(before, editedIndex, normalized);
    pendingEditedDigraphIndex = null;
    if (!tokensEqual(before, merged)) {
      state.current = merged;
      persistGame();
      resetBoardMessage();
      renderBoard();
      if (returnFocusToBoard) {
        elements.boardStage.focus({ preventScroll: true });
      }
      playSound("key");
      announce(
        `Kutia ${editedIndex + 1} u bashkua si ${merged[editedIndex].toLocaleUpperCase("sq-AL")}.`,
      );
      return;
    }
  } else {
    pendingEditedDigraphIndex = null;
  }

  const next = DIGRAPH_SET.has(normalized)
    ? before.length < COLUMN_COUNT
      ? [...before, normalized]
      : before
    : appendPhysicalCharacter(before, normalized, COLUMN_COUNT);

  if (tokensEqual(before, next)) {
    playSound("error");
    return;
  }

  state.current = next;
  state.startedAt ??= Date.now();
  persistGame();
  resetBoardMessage();
  renderBoard();
  playSound("key");
}

function removeLetter() {
  if (state.status !== "playing" || isAnimating || state.current.length === 0) {
    return;
  }

  closeHintConfirmation(false);

  const selectedIndex = getSelectedCurrentIndex();
  const returnFocusToBoard =
    selectedIndex !== null &&
    document.activeElement?.matches?.(`[data-current-index="${selectedIndex}"]`);
  state.current =
    selectedIndex === null
      ? removeLastToken(state.current)
      : removeGuessTokenAt(state.current, selectedIndex);
  selectedCurrentIndex = null;
  pendingEditedDigraphIndex = null;
  persistGame();
  resetBoardMessage();
  renderBoard();
  if (returnFocusToBoard) {
    elements.boardStage.focus({ preventScroll: true });
  }
  playSound("key");
  if (selectedIndex !== null) {
    announce(`Shkronja në kutinë ${selectedIndex + 1} u fshi.`);
  }
}

function submitGuess() {
  if (!ensureCurrentDailyPuzzle() || state.status !== "playing" || isAnimating) {
    return;
  }

  closeHintConfirmation(false);

  if (state.current.length !== COLUMN_COUNT) {
    showInvalid(`Duhet një fjalë me ${COLUMN_COUNT} shkronja shqip.`);
    return;
  }

  const guessWord = state.current.join("");
  if (!ACCEPTED_GUESSES.has(guessWord) && !ANSWER_SET.has(guessWord)) {
    showInvalid("Kjo fjalë nuk është ende në listën tonë.");
    showReportLink(guessWord);
    return;
  }

  const answerTokens = getAnswerTokens();
  const guessTokens = [...state.current];
  const statuses = evaluateGuess(answerTokens, guessTokens);
  state.guesses.push(guessTokens);
  state.current = [];
  selectedCurrentIndex = null;
  pendingEditedDigraphIndex = null;
  state.startedAt ??= Date.now();

  if (statuses.every((status) => status === "correct")) {
    state.status = "won";
    state.completedAt = Date.now();
  } else if (getStateAttemptCount() >= ROW_COUNT) {
    state.status = "lost";
    state.completedAt = Date.now();
  }

  persistGame();
  isAnimating = true;
  animatingRow = getStateAttemptCount() - 1;
  resetBoardMessage();
  renderBoard();
  renderMeta();
  playSound("submit");

  const announcement = guessTokens
    .map((token, index) => `${token.toLocaleUpperCase("sq-AL")}, ${STATUS_LABEL[statuses[index]]}`)
    .join(". ");
  const revealDuration = REDUCED_MOTION.matches ? 10 : 760;

  revealTimer = window.setTimeout(() => {
    isAnimating = false;
    animatingRow = null;
    announce(`Prova ${getStateAttemptCount()}. ${announcement}`);

    if (state.status === "playing") {
      renderAll();
      return;
    }

    finishGame();
  }, revealDuration);
}

function finishGame() {
  recordCompletedGame();
  justCompletedPuzzleId = state.puzzleId;
  persistGame();
  renderAll();
  elements.resultPanel.focus({ preventScroll: true });

  if (state.status === "won") {
    const attemptCount = getStateAttemptCount();
    playSound("win");
    showCelebration();
    announce(
      `E gjete fjalën ${getAnswer().word} në ${attemptCount} ${attemptCount === 1 ? "provë" : "prova"}.`,
    );
  } else {
    playSound("error");
    announce(`Loja mbaroi. Fjala ishte ${getAnswer().word}.`);
  }

  window.setTimeout(() => {
    elements.resultPanel.scrollIntoView({
      block: "start",
      behavior: REDUCED_MOTION.matches ? "auto" : "smooth",
    });
  }, REDUCED_MOTION.matches ? 0 : 420);
}

function showInvalid(message) {
  invalidPulse = true;
  renderBoard();
  setBoardMessage(message, "error");
  showToast(message);
  playSound("error");
  window.clearTimeout(invalidTimer);
  invalidTimer = window.setTimeout(() => {
    invalidPulse = false;
    elements.board.classList.remove("is-invalid");
  }, 360);
}

// Build a mailto: link that pre-fills a "missing word" report. When a rating is
// supplied (the "Ka një gabim" path) it is named in the body so the note is
// self-explanatory even without the surrounding UI.
function buildReportMailto(word, rating = null) {
  const reportsProblem = rating === "ka_gabim";
  const subject = reportsProblem
    ? "FJALË — problem me fjalën"
    : "FJALË — fjalë që mungon";
  const body = [
    `Fjala: ${word.toLocaleUpperCase("sq-AL")}`,
    rating ? `Vlerësimi: ${WORD_RATING_LABELS[rating]}` : null,
    "",
    "Shënim (opsional): ",
  ]
    .filter((line) => line !== null)
    .join("\n");

  return `mailto:${REPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function buildReportLink(word, rating = null) {
  const link = document.createElement("a");
  link.className = "report-link";
  link.href = buildReportMailto(word, rating);
  link.textContent =
    rating === "ka_gabim"
      ? "Na trego me email çfarë nuk shkon."
      : "Mungon një fjalë? Na dërgo me email.";
  // Persist the report locally too, so it survives even if the mail is never
  // actually sent. The click still follows through to the mail client.
  link.addEventListener("click", () => recordReportedWord(word));
  return link;
}

// Show the quiet report link beneath the board for a freshly rejected word.
// It clears on the next input via resetBoardMessage -> hideReportLink.
function showReportLink(word) {
  elements.boardReport.replaceChildren(buildReportLink(word));
  elements.boardReport.hidden = false;
}

function hideReportLink() {
  if (!elements.boardReport.hidden) {
    elements.boardReport.replaceChildren();
    elements.boardReport.hidden = true;
  }
}

function recordReportedWord(word) {
  const normalized = normalizeWord(word);
  if (!normalized) {
    return;
  }

  // Re-read so a concurrent tab's reports are not clobbered.
  profile = loadProfile();
  profile.reportedWords = sanitizeReportedWords([...profile.reportedWords, normalized]);
  saveProfile();
}

function getHintRequestError() {
  if (state.status !== "playing") {
    return "Kjo lojë ka përfunduar.";
  }

  if (state.besa) {
    return "Ke dhënë Besën: kjo lojë luhet pa gjurmë.";
  }

  if (state.usedHint) {
    return "Gjurmën e ke tashmë të hapur.";
  }

  if (isAnimating) {
    return "Prit sa të hapet prova.";
  }

  if (state.guesses.length < HINT_UNLOCK_GUESS) {
    const remaining = HINT_UNLOCK_GUESS - state.guesses.length;
    return remaining === 1
      ? "Gjurmë pas një prove tjetër."
      : `Gjurmë pas ${remaining} provash të tjera.`;
  }

  if (state.current.length > 0) {
    return "Fshi shkronjat e provës së nisur para se të hapësh gjurmën.";
  }

  if (state.guesses.length >= ROW_COUNT - 1) {
    return "Gjurmën nuk mund ta hapësh në provën e fundit.";
  }

  return null;
}

function requestHint() {
  if (hintConfirmationOpen) {
    closeHintConfirmation(true);
    return;
  }

  const error = getHintRequestError();
  if (error) {
    showToast(error);
    return;
  }

  const remainingAfterHint = ROW_COUNT - getAttemptCount(state.guesses.length, true);
  elements.hintConfirmationCopy.textContent =
    remainingAfterHint === 1
      ? "Hapja përdor një provë dhe nuk zhbëhet. Do të të mbetet edhe 1 provë."
      : `Hapja përdor një provë dhe nuk zhbëhet. Do të të mbeten edhe ${remainingAfterHint} prova.`;
  hintConfirmationOpen = true;
  elements.hintConfirmation.hidden = false;
  elements.hintButton.setAttribute("aria-expanded", "true");
  window.requestAnimationFrame(() => elements.hintCancel.focus({ preventScroll: true }));
}

function closeHintConfirmation(restoreFocus) {
  if (!hintConfirmationOpen && elements.hintConfirmation.hidden) {
    return;
  }

  hintConfirmationOpen = false;
  elements.hintConfirmation.hidden = true;
  elements.hintConfirm.disabled = false;
  elements.hintCancel.disabled = false;
  elements.hintButton.setAttribute("aria-expanded", "false");

  if (restoreFocus && !elements.hintButton.disabled) {
    elements.hintButton.focus({ preventScroll: true });
  }
}

function revealHint() {
  const error = getHintRequestError();
  if (error) {
    closeHintConfirmation(false);
    showToast(error);
    return;
  }

  elements.hintConfirm.disabled = true;
  elements.hintCancel.disabled = true;
  state.usedHint = true;
  state.hintRow = state.guesses.length;
  closeHintConfirmation(false);
  persistGame();
  renderAll();

  const remaining = ROW_COUNT - getStateAttemptCount();
  const visibleMessage = `Gjurmë e hapur. U përdor 1 provë; ${remaining === 1 ? "të mbetet 1 provë" : `të mbeten ${remaining} prova`}.`;
  showToast(visibleMessage, `${visibleMessage} Gjurmë: ${getAnswer().clue}`);
  playSound("hint");
  elements.boardStage.focus({ preventScroll: true });
}

function toggleBesa() {
  if (state.status !== "playing") {
    showToast("Besa jepet vetëm para një loje të re.");
    return;
  }

  if (state.guesses.length > 0 || state.current.length > 0 || state.usedHint) {
    showToast("Besa jepet para shkronjës së parë.");
    return;
  }

  state.besa = !state.besa;
  persistGame();
  renderMeta();
  resetBoardMessage();
  showToast(state.besa ? "Besa u dha. Pa gjurmë këtë herë." : "Besa u tërhoq.");
  playSound("key");
}

function renderAll() {
  renderMode();
  renderMeta();
  renderBoard();
  renderKeyboard();
  renderPassport();
  renderResult();
  renderCountdown();
  renderStats();
  resetBoardMessage();
}

function renderMode() {
  const primaryIsActive = state.mode === "daily" || state.mode === "challenge";
  const practiceIsActive = state.mode === "practice";
  const primaryLabel = elements.dailyMode.querySelector("span:first-child");

  primaryLabel.textContent = primaryDescriptor.mode === "challenge" ? "Sfidë" : "Sot";
  elements.dailyDate.textContent =
    primaryDescriptor.mode === "challenge"
      ? "nga një mik"
      : formatDailyDate(primaryDescriptor.dateKey);

  elements.dailyMode.classList.toggle("is-active", primaryIsActive);
  elements.practiceMode.classList.toggle("is-active", practiceIsActive);
  elements.dailyMode.setAttribute("aria-pressed", String(primaryIsActive));
  elements.practiceMode.setAttribute("aria-pressed", String(practiceIsActive));
}

function hasCostlyHint(game = state) {
  return Number.isInteger(game.hintRow);
}

function getStateAttemptCount() {
  return getAttemptCount(state.guesses.length, hasCostlyHint());
}

function renderMeta() {
  const answer = getAnswer();
  const attemptsUntilHint = Math.max(0, HINT_UNLOCK_GUESS - state.guesses.length);
  const noAttemptForHint = !state.usedHint && state.guesses.length >= ROW_COUNT - 1;

  if (hintConfirmationOpen && getHintRequestError()) {
    closeHintConfirmation(false);
  }

  if (state.mode === "daily") {
    elements.puzzleKicker.textContent = "Fjala e ditës";
    elements.puzzleInstruction.textContent = "Pesë shkronja. Gjashtë prova.";
  } else if (state.mode === "archive") {
    elements.puzzleKicker.textContent = "Nga arkiva";
    elements.puzzleInstruction.textContent = `Fjala e ${formatFullDate(archiveDateKey())}. Gjashtë prova.`;
  } else if (state.mode === "challenge") {
    elements.puzzleKicker.textContent = "Sfida e mikut";
    elements.puzzleInstruction.textContent = "E njëjta fjalë. Sa prova të duhen?";
  } else {
    elements.puzzleKicker.textContent = "Fjalë pa fund";
    elements.puzzleInstruction.textContent = "Një raund i ri, pa pritur nesër.";
  }

  elements.hintBadge.textContent = state.usedHint
    ? "✓"
    : state.besa
      ? "—"
      : noAttemptForHint
        ? "×"
        : attemptsUntilHint > 0
          ? String(attemptsUntilHint)
          : "−1";
  elements.hintButton.disabled =
    state.status !== "playing" || state.usedHint || state.besa || isAnimating || noAttemptForHint;
  elements.hintButton.setAttribute("aria-expanded", String(hintConfirmationOpen));
  elements.hintButton.setAttribute(
    "aria-label",
    state.usedHint
      ? "Gjurmë e hapur"
      : state.besa
        ? "Gjurmë e mbyllur nga Besa"
        : noAttemptForHint
          ? "Gjurmë e mbyllur në provën e fundit"
          : attemptsUntilHint > 0
            ? attemptsUntilHint === 1
              ? "Gjurmë, hapet pas një prove"
              : `Gjurmë, hapet pas ${attemptsUntilHint} provash`
            : hintConfirmationOpen
              ? "Mbyll konfirmimin e gjurmës"
              : "Hap gjurmën, përdor 1 provë",
  );
  elements.besaButton.disabled = state.status !== "playing";
  elements.besaButton.setAttribute("aria-pressed", String(state.besa));
  elements.hintConfirmation.hidden = !hintConfirmationOpen;
  elements.hintCard.classList.toggle("is-revealed", state.usedHint);
  elements.besaCard.classList.toggle("is-active", state.besa);

  if (state.usedHint) {
    elements.hintDescription.textContent = formatHintMetadata(
      answer.partOfSpeech,
      answer.syllables,
    );
    elements.hintCopy.textContent = answer.clue;
  } else if (state.besa) {
    elements.hintDescription.textContent = "E mbyllur nga Besa.";
    elements.hintCopy.textContent = "Këtë raund do ta zgjidhësh vetëm me provat e tua.";
  } else if (state.status !== "playing") {
    elements.hintDescription.textContent = "Pa gjurmë këtë herë.";
    elements.hintCopy.textContent = "Fjala dhe shpjegimi i saj janë më sipër.";
  } else if (noAttemptForHint) {
    elements.hintDescription.textContent = "E mbyllur në provën e fundit.";
    elements.hintCopy.textContent = "Duhet të mbetet një provë për përgjigjen.";
  } else if (attemptsUntilHint > 0) {
    elements.hintDescription.textContent =
      attemptsUntilHint === 1
        ? "Hapet pas një prove."
        : `Hapet pas ${attemptsUntilHint} provash.`;
    elements.hintCopy.textContent =
      "Tregon llojin dhe kuptimin pa zbuluar shkronja. Përdor një provë.";
  } else {
    elements.hintDescription.textContent = "Gati. Hapja përdor 1 provë.";
    elements.hintCopy.textContent = "Tregon llojin dhe kuptimin pa zbuluar shkronja.";
  }

  elements.besaDescription.textContent = state.besa
    ? "Premtimi është aktiv për këtë raund."
    : state.guesses.length > 0 || state.current.length > 0
      ? "Jepet vetëm para shkronjës së parë."
      : "Premto pa gjurmë para provës së parë.";
}

function renderBoard() {
  elements.board.replaceChildren();
  elements.board.classList.toggle("is-invalid", invalidPulse);
  elements.board.classList.toggle("is-won", state.status === "won" && !isAnimating);
  const answerTokens = getAnswerTokens();
  const currentAttemptIndex = getStateAttemptCount();

  for (let rowIndex = 0; rowIndex < ROW_COUNT; rowIndex += 1) {
    const row = document.createElement("div");
    row.className = "board-row";
    row.setAttribute("role", "row");
    row.setAttribute("aria-rowindex", String(rowIndex + 1));

    if (hasCostlyHint() && rowIndex === state.hintRow) {
      row.classList.add("board-hint-row");
      const cell = document.createElement("div");
      cell.className = "hint-attempt-cell";
      cell.setAttribute("role", "gridcell");
      cell.setAttribute("aria-colindex", "1");
      cell.setAttribute("aria-colspan", String(COLUMN_COUNT));
      cell.setAttribute("aria-label", `Prova ${rowIndex + 1} u përdor për gjurmën.`);
      const icon = elements.hintButton.querySelector("svg")?.cloneNode(true);
      if (icon) {
        cell.append(icon);
      }
      const label = document.createElement("span");
      label.textContent = "Gjurmë · 1 provë e përdorur";
      cell.append(label);
      row.append(cell);
      elements.board.append(row);
      continue;
    }

    const guessIndex = hasCostlyHint() && rowIndex > state.hintRow ? rowIndex - 1 : rowIndex;
    const submittedGuess = state.guesses[guessIndex] ?? null;
    const isCurrentRow = rowIndex === currentAttemptIndex && state.status === "playing";
    const tokens = submittedGuess ?? (isCurrentRow ? state.current : []);
    const statuses = submittedGuess ? evaluateGuess(answerTokens, submittedGuess) : null;

    for (let columnIndex = 0; columnIndex < COLUMN_COUNT; columnIndex += 1) {
      const token = tokens[columnIndex] ?? "";
      const status = statuses?.[columnIndex] ?? null;
      const tile = document.createElement("div");
      tile.className = "tile";
      tile.setAttribute("role", "gridcell");
      tile.setAttribute("aria-colindex", String(columnIndex + 1));

      if (token) {
        // The letter lives in its own span so digraphs can be condensed
        // horizontally without touching the tile box, border, corner mark,
        // or reveal animation.
        const letter = document.createElement("span");
        letter.className = "tile-letter";
        letter.textContent = token.toLocaleUpperCase("sq-AL");
        tile.append(letter);
        tile.classList.add("is-filled");
      }

      if (DIGRAPH_SET.has(token)) {
        tile.classList.add("is-digraph");
      }

      if (isCurrentRow) {
        tile.classList.add("is-current-row");
        if (token) {
          const selected = columnIndex === getSelectedCurrentIndex();
          tile.classList.add("is-editable");
          tile.classList.toggle("is-selected", selected);
          tile.dataset.currentIndex = String(columnIndex);
          tile.tabIndex = 0;
          tile.setAttribute("aria-selected", String(selected));
        }
      }

      if (status) {
        tile.classList.add(`is-${status}`);
        const mark = document.createElement("span");
        mark.className = "tile-status";
        mark.setAttribute("aria-hidden", "true");
        mark.textContent = STATUS_MARK[status];
        tile.append(mark);

        if (animatingRow === rowIndex) {
          tile.classList.add("is-revealing");
          tile.style.setProperty("--reveal-delay", `${columnIndex * 72}ms`);
        }
      }

      const letterLabel = token ? token.toLocaleUpperCase("sq-AL") : "bosh";
      const statusLabel = status ? `, ${STATUS_LABEL[status]}` : "";
      const editLabel =
        isCurrentRow && token
          ? columnIndex === getSelectedCurrentIndex()
            ? ", e zgjedhur për zëvendësim"
            : ". Zgjidhe për ta zëvendësuar"
          : "";
      tile.setAttribute(
        "aria-label",
        `Rreshti ${rowIndex + 1}, kutia ${columnIndex + 1}: ${letterLabel}${statusLabel}${editLabel}`,
      );
      row.append(tile);
    }

    elements.board.append(row);
  }

  syncEnterReady();
}

// Toggle the Enter key's ready accent from the existing per-input render path
// (renderBoard runs on every letter add/remove) without re-rendering the whole
// keyboard. renderKeyboard sets the same class when it rebuilds the key.
function syncEnterReady() {
  const enterKey = elements.keyboard.querySelector('button[data-key="enter"]');
  if (!enterKey) {
    return;
  }
  const ready = state.status === "playing" && state.current.length === COLUMN_COUNT;
  enterKey.classList.toggle("is-ready", ready);
}

function renderKeyboard() {
  const focusedValue = document.activeElement?.closest?.("button[data-key]")?.dataset.key;
  const keyStatuses = new Map();
  const answerTokens = getAnswerTokens();

  for (const guess of state.guesses) {
    const statuses = evaluateGuess(answerTokens, guess);
    guess.forEach((token, index) => {
      const previous = keyStatuses.get(token);
      const next = statuses[index];
      if (!previous || STATUS_RANK[next] > STATUS_RANK[previous]) {
        keyStatuses.set(token, next);
      }
    });
  }

  elements.keyboard.replaceChildren();
  for (const keys of KEYBOARD_ROWS) {
    const row = document.createElement("div");
    row.className = "keyboard-row";
    row.classList.toggle("is-short-row", keys.includes("backspace"));

    for (const value of keys) {
      const key = document.createElement("button");
      key.type = "button";
      key.className = "key";
      key.dataset.key = value;
      key.disabled = state.status !== "playing" || isAnimating;

      if (value === "enter") {
        key.classList.add("is-wide");
        if (state.status === "playing" && state.current.length === COLUMN_COUNT) {
          key.classList.add("is-ready");
        }
        key.setAttribute("aria-label", "Provo fjalën");
        key.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M20 5v7H6"></path><path d="m10 8-4 4 4 4"></path></svg>';
      } else if (value === "backspace") {
        key.classList.add("is-wide");
        key.setAttribute("aria-label", "Fshi shkronjën e zgjedhur ose të fundit");
        key.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m9 7-5 5 5 5h10V7z"></path><path d="m12 10 4 4M16 10l-4 4"></path></svg>';
      } else {
        key.textContent = value.toLocaleUpperCase("sq-AL");
        key.setAttribute("aria-label", `Shkronja ${value.toLocaleUpperCase("sq-AL")}`);
        const status = keyStatuses.get(value);
        if (status) {
          key.classList.add(`is-${status}`);
          key.setAttribute("aria-label", `${key.getAttribute("aria-label")}, ${STATUS_LABEL[status]}`);
          const mark = document.createElement("span");
          mark.className = "key-status";
          mark.setAttribute("aria-hidden", "true");
          mark.textContent = STATUS_MARK[status];
          key.append(mark);
        }
      }

      row.append(key);
    }

    elements.keyboard.append(row);
  }

  if (focusedValue && state.status === "playing" && !isAnimating) {
    elements.keyboard
      .querySelector(`button[data-key="${CSS.escape(focusedValue)}"]`)
      ?.focus({ preventScroll: true });
  }
}

function renderPassport() {
  const collected = new Set(profile.collection);
  const count = collected.size;
  const missingDigraph = ALBANIAN_DIGRAPHS.find((letter) => !collected.has(letter));

  elements.headerProgress.textContent = String(count);
  elements.passportButton.setAttribute(
    "aria-label",
    `Pasaporta e alfabetit, ${count} nga ${ALBANIAN_ALPHABET.length} shkronja të mbledhura`,
  );
  elements.passportCount.textContent = String(count);
  elements.passportCopy.textContent = `${count} nga ${ALBANIAN_ALPHABET.length} shkronja`;
  elements.passportDialogCount.textContent = `${count} / ${ALBANIAN_ALPHABET.length}`;
  elements.passportRing.style.setProperty("--progress", `${count / ALBANIAN_ALPHABET.length}turn`);
  elements.passportTip.textContent =
    count === ALBANIAN_ALPHABET.length
      ? "Alfabeti u plotësua. Të 36 shkronjat kanë vulën tënde!"
      : missingDigraph
        ? `Në kërkim të ${missingDigraph.toLocaleUpperCase("sq-AL")} — zgjidh fjalë të reja për ta gjetur.`
        : "Dyshkronjëshat u mblodhën. Tani plotëso pjesën tjetër të alfabetit.";

  elements.rareLetterRow.replaceChildren();
  for (const letter of ALBANIAN_DIGRAPHS) {
    const stamp = document.createElement("span");
    stamp.className = "rare-letter";
    stamp.textContent = letter.toLocaleUpperCase("sq-AL");
    stamp.classList.toggle("is-collected", collected.has(letter));
    stamp.setAttribute(
      "aria-label",
      `${letter.toLocaleUpperCase("sq-AL")}: ${collected.has(letter) ? "e mbledhur" : "ende pa u mbledhur"}`,
    );
    elements.rareLetterRow.append(stamp);
  }

  elements.alphabetGrid.replaceChildren();
  for (const letter of ALBANIAN_ALPHABET) {
    const stamp = document.createElement("span");
    const isCollected = collected.has(letter);
    stamp.className = "alphabet-stamp";
    stamp.textContent = letter.toLocaleUpperCase("sq-AL");
    stamp.classList.toggle("is-digraph", DIGRAPH_SET.has(letter));
    stamp.classList.toggle("is-collected", isCollected);
    stamp.setAttribute(
      "aria-label",
      `${letter.toLocaleUpperCase("sq-AL")}: ${isCollected ? "e mbledhur" : "ende pa u mbledhur"}`,
    );
    elements.alphabetGrid.append(stamp);
  }
}

function renderResult() {
  const isComplete = state.status !== "playing" && !isAnimating;
  elements.resultPanel.hidden = !isComplete;
  renderWordRating(isComplete);

  if (!isComplete) {
    return;
  }

  const answer = getAnswer();
  const answerTokens = getAnswerTokens();
  const digraphs = [...new Set(answerTokens.filter((token) => DIGRAPH_SET.has(token)))];
  const won = state.status === "won";
  const besaEarned = won && state.besa && !state.usedHint;
  const attemptCount = getStateAttemptCount();
  const hintLabel = state.usedHint ? " · me gjurmë" : "";

  elements.resultLabel.textContent = won
    ? `E gjete në ${attemptCount} ${attemptCount === 1 ? "provë" : "prova"}${besaEarned ? " · Besa ✓" : hintLabel}`
    : `Fjala ishte${hintLabel}`;
  // The engraved seal is reserved for the genuine no-hint daily Besa win.
  elements.resultBesaSeal.hidden = !(besaEarned && state.mode === "daily");
  elements.resultTime.textContent = formatDuration(elapsedSeconds());
  elements.resultWord.textContent = answer.word.toLocaleUpperCase("sq-AL");
  elements.resultMeta.textContent = [
    answer.partOfSpeech,
    answer.syllables,
    digraphs.length > 0 ? `me ${digraphs.map((token) => token.toLocaleUpperCase("sq-AL")).join(", ")}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  elements.resultDefinition.textContent = answer.definition;
  elements.resultExample.textContent = `“${answer.example}”`;
}

// Render the post-game word rating row. Interactive chips appear only for a game
// that just concluded live and has not been rated; a game already rated collapses
// to a subtle thanks; anything else (still playing, or a completion predating this
// feature) shows nothing.
function renderWordRating(isComplete) {
  const container = elements.wordRating;
  container.replaceChildren();

  const existing = profile.wordRatings?.[state.puzzleId] ?? null;
  const justCompleted = justCompletedPuzzleId === state.puzzleId;

  if (!isComplete || (!existing && !justCompleted)) {
    container.hidden = true;
    return;
  }

  container.hidden = false;

  if (existing) {
    const thanks = document.createElement("p");
    thanks.className = "word-rating-thanks";
    thanks.tabIndex = -1;
    thanks.textContent = "Faleminderit!";
    container.append(thanks);
    if (existing.rating === "ka_gabim") {
      container.append(buildReportLink(existing.word, existing.rating));
    }
    return;
  }

  const prompt = document.createElement("p");
  prompt.className = "word-rating-prompt";
  prompt.textContent = "Si ishte fjala?";

  const chips = document.createElement("div");
  chips.className = "word-rating-chips";
  chips.setAttribute("role", "group");
  chips.setAttribute("aria-label", "Vlerëso fjalën");

  for (const value of WORD_RATING_VALUES) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "word-rating-chip";
    chip.textContent = WORD_RATING_LABELS[value];
    chip.setAttribute("aria-label", `Vlerëso fjalën: ${WORD_RATING_LABELS[value]}`);
    chip.addEventListener("click", () => rateWord(value));
    chips.append(chip);
  }

  container.append(prompt, chips);
}

function rateWord(rating) {
  if (!WORD_RATING_LABELS[rating] || state.status === "playing") {
    return;
  }

  const answer = getAnswer();
  // Re-read so a concurrent tab's ratings are not clobbered, then upsert.
  profile = loadProfile();
  profile.wordRatings[state.puzzleId] = {
    word: answer.word,
    rating,
    at: Date.now(),
  };
  profile.wordRatings = sanitizeWordRatings(profile.wordRatings);
  saveProfile();

  renderWordRating(true);
  elements.wordRating.querySelector(".word-rating-thanks")?.focus({ preventScroll: true });
  announce("Faleminderit për vlerësimin.");
}

function renderStats() {
  const modeStats = profile.modeStats;
  const daily = modeStats.daily;

  // Sot (Daily) — the player's identity: streak first, then the daily record
  // sourced strictly from modeStats (starts at zero for returning players).
  elements.statStreak.textContent = String(profile.currentStreak);
  elements.statBest.textContent = String(profile.bestStreak);
  elements.statDailyPlayed.textContent = String(daily.played);
  elements.statDailyWon.textContent = String(daily.won);
  elements.statDailyWinRate.textContent = formatWinRate(daily.won, daily.played);
  renderDistribution(elements.dailyDistribution, daily.distribution, null);

  // Arkiva — played/won only; the calendar stays in this section.
  elements.statArchivePlayed.textContent = String(modeStats.archive.played);
  elements.statArchiveWon.textContent = String(modeStats.archive.won);

  // Pa fund — practice played/won, plus challenge count when nonzero.
  elements.statPracticePlayed.textContent = String(modeStats.practice.played);
  elements.statPracticeWon.textContent = String(modeStats.practice.won);
  const challengePlayed = modeStats.challenge.played;
  elements.statChallengeLine.hidden = challengePlayed === 0;
  elements.statChallengeCount.textContent = String(challengePlayed);

  // Gjithsej (Overall) — the untouched legacy totals and distribution.
  elements.statPlayed.textContent = String(profile.played);
  elements.statWinRate.textContent = formatWinRate(profile.won, profile.played);
  elements.statBesa.textContent = String(profile.besaWins);
  renderDistribution(elements.distribution, profile.distribution, profile.lastWinGuesses);

  renderCalendar();
}

function formatWinRate(won, played) {
  return `${played > 0 ? Math.round((won / played) * 100) : 0}%`;
}

function renderDistribution(container, distribution, highlightGuesses) {
  const maxValue = Math.max(1, ...distribution);

  // Screen-reader summary: name the modal bucket so the chart's shape is
  // available without stepping through every bar. role="group" keeps the
  // per-row numbers reachable beneath the label.
  const totalWins = distribution.reduce((sum, value) => sum + value, 0);
  const modalGuesses = distribution.indexOf(Math.max(...distribution)) + 1;
  container.setAttribute("role", "group");
  container.setAttribute(
    "aria-label",
    totalWins === 0
      ? "Shpërndarja e fitoreve: ende pa fitore."
      : `Shpërndarja e fitoreve: shumica e fitoreve në ${modalGuesses} ${modalGuesses === 1 ? "provë" : "prova"}.`,
  );

  container.replaceChildren();
  distribution.forEach((value, index) => {
    const row = document.createElement("div");
    row.className = "distribution-row";
    row.classList.toggle("is-current", highlightGuesses === index + 1);

    const label = document.createElement("span");
    label.textContent = String(index + 1);
    const track = document.createElement("div");
    track.className = "distribution-track";
    const bar = document.createElement("div");
    bar.className = "distribution-bar";
    bar.textContent = String(value);
    bar.style.setProperty("--bar-width", `${Math.max(8, (value / maxValue) * 100)}%`);
    track.append(bar);
    row.append(label, track);
    container.append(row);
  });
}

function renderCountdown() {
  const showCountdown =
    state.mode === "daily" && state.status !== "playing" && !isAnimating;

  if (!showCountdown) {
    stopCountdown();
    elements.resultCountdown.hidden = true;
    return;
  }

  elements.resultCountdown.hidden = false;
  tickCountdown();
  if (!countdownTimer) {
    countdownTimer = window.setInterval(tickCountdown, 1000);
  }
}

function tickCountdown() {
  // Past Tirana midnight the mounted daily belongs to yesterday. Swap to the
  // new day's puzzle immediately instead of rendering a fresh 24h countdown.
  // (renderCountdown only starts this timer in daily mode, so puzzleId is
  // always "daily-YYYY-MM-DD" here.)
  if (state.puzzleId !== `daily-${getTiranaDateKey()}`) {
    stopCountdown();
    ensureCurrentDailyPuzzle();
    return;
  }

  const seconds = secondsUntilNextTiranaDay(new Date());
  elements.resultCountdown.textContent = `Fjala e re në ${formatDuration(seconds)}`;
}

function stopCountdown() {
  if (countdownTimer) {
    window.clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

function renderCalendar() {
  const todayKey = getTiranaDateKey();
  const [todayYear, todayMonth] = todayKey.split("-").map(Number);
  const [epochYear, epochMonth] = ARCHIVE_EPOCH.split("-").map(Number);

  if (!calendarView) {
    calendarView = { year: todayYear, month: todayMonth };
  }

  const minOrdinal = monthOrdinal(epochYear, epochMonth);
  const maxOrdinal = monthOrdinal(todayYear, todayMonth);
  const viewOrdinal = clamp(
    monthOrdinal(calendarView.year, calendarView.month),
    minOrdinal,
    maxOrdinal,
  );
  calendarView = ordinalToMonth(viewOrdinal);

  const { year, month } = calendarView;
  elements.calendarTitle.textContent = `${ALBANIAN_MONTHS_LONG[month - 1]} ${year}`;
  elements.calendarPrev.disabled = viewOrdinal <= minOrdinal;
  elements.calendarNext.disabled = viewOrdinal >= maxOrdinal;

  elements.calendarHead.replaceChildren();
  const headRow = document.createElement("tr");
  ALBANIAN_WEEKDAYS_SHORT.forEach((label, index) => {
    const header = document.createElement("th");
    header.className = "calendar-weekday";
    header.scope = "col";
    header.textContent = label;
    header.setAttribute("aria-label", ALBANIAN_WEEKDAYS_LONG[index]);
    headRow.append(header);
  });
  elements.calendarHead.append(headRow);

  elements.calendarBody.replaceChildren();
  // Monday-first: JS getUTCDay() is 0=Sunday, so shift to Monday=0.
  const leadingBlanks = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells = [];

  for (let index = 0; index < leadingBlanks; index += 1) {
    cells.push(document.createElement("td"));
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateKey = `${year}-${pad2(month)}-${pad2(day)}`;
    cells.push(buildCalendarCell(dateKey, day, todayKey));
  }

  while (cells.length % 7 !== 0) {
    cells.push(document.createElement("td"));
  }

  for (let start = 0; start < cells.length; start += 7) {
    const weekRow = document.createElement("tr");
    weekRow.append(...cells.slice(start, start + 7));
    elements.calendarBody.append(weekRow);
  }
}

function buildCalendarCell(dateKey, day, todayKey) {
  const isToday = dateKey === todayKey;
  const inRange = dateKey >= ARCHIVE_EPOCH && dateKey <= todayKey;
  const result = profile.dailyResults[dateKey];
  const won = Number.isInteger(result);
  const lost = result === "X";
  // Secondary dedupe: a day whose game id is already in completedPuzzles must
  // never be replayable, even if its dailyResults entry is ever missing.
  // (completedPuzzles is capped, so this guard is a long-lived secondary check.)
  const alreadyCompleted =
    profile.completedPuzzles.includes(`daily-${dateKey}`) ||
    profile.completedPuzzles.includes(`archive-${dateKey}`);
  const playable = inRange && !won && !lost && !isToday && !alreadyCompleted;

  const cellWrap = document.createElement("td");
  const cell = document.createElement(playable ? "button" : "div");
  cell.className = "calendar-cell";
  cellWrap.append(cell);
  const dateLabel = formatFullDate(dateKey);

  if (playable) {
    cell.type = "button";
    cell.dataset.date = dateKey;
    cell.classList.add("is-playable");
  }

  const number = document.createElement("span");
  number.className = "calendar-day";
  number.setAttribute("aria-hidden", "true");
  number.textContent = String(day);
  cell.append(number);

  let stateLabel;
  if (won) {
    cell.classList.add("is-won");
    const badge = document.createElement("span");
    badge.className = "calendar-badge";
    badge.setAttribute("aria-hidden", "true");
    badge.textContent = String(result);
    cell.append(badge);
    const mark = document.createElement("span");
    mark.className = "calendar-mark";
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = "✓";
    cell.append(mark);
    stateLabel = `fituar me ${result} ${result === 1 ? "provë" : "prova"}`;
  } else if (lost) {
    cell.classList.add("is-lost");
    const mark = document.createElement("span");
    mark.className = "calendar-mark";
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = "×";
    cell.append(mark);
    stateLabel = "e humbur";
  } else if (playable) {
    stateLabel = "e paluajtur — prek për ta luajtur nga arkiva";
  } else if (isToday) {
    stateLabel = "sot, luaj fjalën e ditës";
  } else if (alreadyCompleted && inRange) {
    cell.classList.add("is-inert");
    stateLabel = "e luajtur";
  } else if (dateKey > todayKey) {
    cell.classList.add("is-inert");
    stateLabel = "ende s’ka ardhur";
  } else {
    cell.classList.add("is-inert");
    stateLabel = "jashtë arkivës";
  }

  if (isToday) {
    cell.classList.add("is-today");
  }

  const fullLabel = `${dateLabel} ${dateKey.slice(0, 4)}: ${stateLabel}`;
  if (playable) {
    cell.setAttribute("aria-label", fullLabel);
  } else {
    // Non-interactive cells carry their label as screen-reader-only table
    // text; the visible glyphs above are aria-hidden duplicates of it.
    const srLabel = document.createElement("span");
    srLabel.className = "sr-only";
    srLabel.textContent = fullLabel;
    cell.append(srLabel);
  }

  return cellWrap;
}

function handleCalendarClick(event) {
  const cell = event.target.closest("button[data-date]");
  if (cell) {
    startArchiveGame(cell.dataset.date);
  }
}

function shiftCalendar(direction) {
  if (!calendarView) {
    return;
  }

  calendarView = ordinalToMonth(
    monthOrdinal(calendarView.year, calendarView.month) + direction,
  );
  renderCalendar();
}

function recordCompletedGame() {
  if (state.status === "playing" || state.recorded) {
    return;
  }

  // Pull in progress written by another open tab before applying this result.
  profile = loadProfile();
  const result = applyCompletedGameToProfile(
    profile,
    {
      puzzleId: state.puzzleId,
      mode: state.mode,
      status: state.status,
      attemptCount: getStateAttemptCount(),
      answerTokens: getAnswerTokens(),
      besa: state.besa,
      usedHint: state.usedHint,
    },
    COMPLETED_PUZZLES_CAP,
  );
  state.recorded = true;
  if (result.recorded) {
    profile = result.profile;
    saveProfile();
  }
}

function normalizeExpiredStreak() {
  if (!profile.lastDailyWin) {
    return;
  }

  const difference = dateKeyOrdinal(getTiranaDateKey()) - dateKeyOrdinal(profile.lastDailyWin);
  if (difference > 1 && profile.currentStreak !== 0) {
    profile.currentStreak = 0;
    saveProfile();
  }
}

async function shareResult() {
  if (state.status === "playing") {
    return;
  }

  const score = state.status === "won" ? getStateAttemptCount() : "X";
  const puzzleLabel =
    state.mode === "daily"
      ? formatShareDate(state.puzzleId.replace("daily-", ""))
      : state.mode === "archive"
        ? `Arkivë · ${formatShareDate(state.puzzleId.replace("archive-", ""))}`
        : state.mode === "challenge"
          ? "Sfidë"
          : "Pa fund";
  const badges = [
    state.besa && !state.usedHint && state.status === "won" ? "🛡️ Besa" : null,
    state.usedHint ? "💡 Me gjurmë" : null,
  ].filter(Boolean);
  const gridRows = state.guesses.map((guess) =>
    evaluateGuess(getAnswerTokens(), guess)
      .map((status) => SHARE_MARK[status])
      .join(" "),
  );
  if (hasCostlyHint()) {
    gridRows.splice(state.hintRow, 0, "💡 Gjurmë");
  }
  const grid = gridRows.join("\n");
  const text = [
    `FJALË · ${puzzleLabel}`,
    [`${score}/${ROW_COUNT}`, formatDuration(elapsedSeconds()), ...badges].join(" · "),
    "",
    grid,
    "",
    "✓ në vend · • diku tjetër · × jo në fjalë",
  ]
    .filter((line, index, lines) => line !== "" || lines[index - 1] !== "")
    .join("\n");

  await shareOrCopy({
    title: "FJALË · Rezultati im",
    text,
    url: rootUrl(),
    copiedMessage: "Rezultati u kopjua — gati për ta ndarë.",
  });
}

async function shareChallenge() {
  const code = createChallengeCode(state.answerIndex);
  const url = new URL(rootUrl());
  url.searchParams.set("sfida", code);
  await shareOrCopy({
    title: "Një sfidë në FJALË",
    text: `Të sfidoj në FJALË. E njëjta fjalë, gjashtë prova — sa të duhen ty?`,
    url: url.toString(),
    copiedMessage: "Lidhja e sfidës u kopjua.",
  });
}

async function shareOrCopy({ title, text, url, copiedMessage }) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return;
    } catch (error) {
      if (error?.name === "AbortError") {
        return;
      }
    }
  }

  const copied = await copyText(`${text}\n${url}`);
  showToast(copied ? copiedMessage : "Nuk u kopjua dot. Provo sërish.");
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.className = "sr-only";
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  }
}

function openDialog(id) {
  const dialog = document.querySelector(`#${CSS.escape(id)}`);
  if (!dialog || dialog.open) {
    return;
  }

  if (id === "passport-dialog") {
    renderPassport();
  } else if (id === "stats-dialog") {
    renderStats();
  }

  dialog.showModal();
}

function renderDefaultBoardMessage() {
  if (state.status === "won") {
    return { text: "E gjete! Kuptimi i fjalës të pret më poshtë.", tone: "success" };
  }
  if (state.status === "lost") {
    return { text: "Afër! Shiko fjalën dhe kuptimin e saj më poshtë.", tone: "" };
  }
  if (state.besa) {
    return { text: "Besa u dha — ky raund luhet pa gjurmë.", tone: "success" };
  }
  if (state.usedHint) {
    return { text: `Gjurmë: ${getAnswer().clue}`, tone: "" };
  }
  if (state.current.length > 0) {
    return {
      text: "Prek një shkronjë për ta ndërruar; SH dhe RR zënë një kuti.",
      tone: "",
    };
  }
  return { text: "Dyshkronjëshat si SH dhe RR zënë vetëm një kuti.", tone: "" };
}

function resetBoardMessage() {
  hideReportLink();
  const message = renderDefaultBoardMessage();
  setBoardMessage(message.text, message.tone);
}

function setBoardMessage(text, tone = "") {
  elements.boardMessage.textContent = text;
  elements.boardMessage.classList.toggle("is-error", tone === "error");
  elements.boardMessage.classList.toggle("is-success", tone === "success");
}

function showToast(message, announcement = message) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => elements.toast.classList.remove("is-visible"), 3200);
  announce(announcement);
}

function announce(message) {
  elements.screenReaderStatus.textContent = "";
  window.setTimeout(() => {
    elements.screenReaderStatus.textContent = message;
  }, 20);
}

function showCelebration() {
  if (REDUCED_MOTION.matches) {
    return;
  }

  const pieces = [
    [-112, -72, -95], [-82, -118, 120], [-45, -92, -45], [-12, -126, 80],
    [29, -105, -120], [65, -124, 60], [104, -75, 140], [121, -24, -70],
    [-123, -18, 45], [-88, 34, -125], [78, 34, 95], [112, 16, -40],
  ];
  const colors = ["var(--primary)", "var(--correct)", "var(--ink)"];
  elements.celebration.replaceChildren();

  pieces.forEach(([x, y, rotation], index) => {
    const piece = document.createElement("span");
    piece.className = "celebration-piece";
    piece.style.setProperty("--piece-x", `${x}px`);
    piece.style.setProperty("--piece-y", `${y}px`);
    piece.style.setProperty("--piece-rotate", `${rotation}deg`);
    piece.style.setProperty("--piece-delay", `${index * 18}ms`);
    piece.style.setProperty("--piece-color", colors[index % colors.length]);
    elements.celebration.append(piece);
  });

  window.setTimeout(() => elements.celebration.replaceChildren(), 1100);
}

function getAnswer() {
  // state.answerIndex holds an immutable answer id; resolve by id so a future
  // catalog reordering can never repoint a saved game at a different word.
  return getAnswerById(state.answerIndex);
}

function getAnswerTokens() {
  return tokenizeAlbanian(getAnswer().word);
}

function elapsedSeconds() {
  if (!state.startedAt) {
    return 0;
  }
  return Math.max(0, Math.floor(((state.completedAt ?? Date.now()) - state.startedAt) / 1000));
}

function randomAnswerIndex(excludedId) {
  if (ANSWERS.length <= 1) {
    return ANSWERS[0].id;
  }

  let position = -1;
  let id = excludedId;
  while (id === excludedId) {
    if (window.crypto?.getRandomValues) {
      const value = new Uint32Array(1);
      window.crypto.getRandomValues(value);
      position = value[0] % ANSWERS.length;
    } else {
      position = Math.floor(Math.random() * ANSWERS.length);
    }
    // Return the immutable id, not the raw draw, so practice descriptors speak
    // the same id language as daily and challenge (identical today, id == pos).
    id = ANSWERS[position].id;
  }
  return id;
}

function gameStorageKey(mode, puzzleId) {
  return mode === "practice" ? PRACTICE_KEY : `fjale:game:${puzzleId}`;
}

function persistGame() {
  writeStorage(gameStorageKey(state.mode, state.puzzleId), state);
}

function loadPreferences() {
  const saved = readStorage(PREFERENCES_KEY);
  return {
    theme: ["system", "light", "dark"].includes(saved?.theme) ? saved.theme : "system",
    contrast: Boolean(saved?.contrast),
    sound: Boolean(saved?.sound),
  };
}

function savePreferences() {
  writeStorage(PREFERENCES_KEY, preferences);
}

function applyPreferences() {
  if (preferences.theme === "system") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.dataset.theme = preferences.theme;
  }
  document.documentElement.toggleAttribute("data-contrast", preferences.contrast);
  if (preferences.contrast) {
    document.documentElement.dataset.contrast = "high";
  }
  elements.themeSelect.value = preferences.theme;
  elements.contrastToggle.checked = preferences.contrast;
  elements.soundToggle.checked = preferences.sound;
  updateThemeColor();
}

function updateThemeColor() {
  const dark =
    preferences.theme === "dark" ||
    (preferences.theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#1b1a18" : "#ffffff");
}

function loadProfile() {
  const saved = readStorage(PROFILE_KEY);
  const distribution = Array.isArray(saved?.distribution)
    ? Array.from({ length: ROW_COUNT }, (_, index) => safeNonNegativeInteger(saved.distribution[index]))
    : Array(ROW_COUNT).fill(0);
  const collection = Array.isArray(saved?.collection)
    ? [...new Set(saved.collection.map(normalizeWord).filter((letter) => ALPHABET_SET.has(letter)))]
    : [];
  const completedPuzzles = Array.isArray(saved?.completedPuzzles)
    ? saved.completedPuzzles
        .filter((id) => typeof id === "string")
        .slice(-COMPLETED_PUZZLES_CAP)
    : [];

  return {
    played: safeNonNegativeInteger(saved?.played),
    won: safeNonNegativeInteger(saved?.won),
    currentStreak: safeNonNegativeInteger(saved?.currentStreak),
    bestStreak: safeNonNegativeInteger(saved?.bestStreak),
    lastDailyWin: /^\d{4}-\d{2}-\d{2}$/.test(saved?.lastDailyWin) ? saved.lastDailyWin : null,
    lastWinGuesses: Number.isInteger(saved?.lastWinGuesses) ? saved.lastWinGuesses : null,
    besaWins: safeNonNegativeInteger(saved?.besaWins),
    distribution,
    collection,
    completedPuzzles,
    // Additive field: old profiles simply produce an empty map, no data loss.
    dailyResults: sanitizeDailyResults(saved?.dailyResults, ROW_COUNT),
    // Additive per-mode statistics. A legacy profile with no modeStats yields an
    // all-zero record; the legacy top-level fields above remain the "Overall".
    modeStats: sanitizeModeStats(saved?.modeStats, ROW_COUNT),
    // Additive trust fields; both default to empty for legacy profiles.
    wordRatings: sanitizeWordRatings(saved?.wordRatings),
    reportedWords: sanitizeReportedWords(saved?.reportedWords),
  };
}

function saveProfile() {
  writeStorage(PROFILE_KEY, profile);
}

function readStorage(key) {
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // The game remains fully playable when storage is unavailable.
  }
}

function tokensEqual(left, right) {
  return left.length === right.length && left.every((token, index) => token === right[index]);
}

function isSafeTimestamp(value) {
  return Number.isFinite(value) && value > 0 && value <= Date.now() + 60_000;
}

function safeNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function dateKeyOrdinal(key) {
  const [year, month, day] = key.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

function formatDailyDate(key) {
  const [, month, day] = key.split("-").map(Number);
  return `${day} ${ALBANIAN_MONTHS_SHORT[month - 1]}`;
}

function formatFullDate(key) {
  const [, month, day] = key.split("-").map(Number);
  return `${day} ${ALBANIAN_MONTHS_LONG[month - 1]}`;
}

function formatShareDate(key) {
  const [year] = key.split("-").map(Number);
  return `${formatDailyDate(key)} ${year}`;
}

function archiveDateKey() {
  return state.puzzleId.replace("archive-", "");
}

function monthOrdinal(year, month) {
  return year * 12 + (month - 1);
}

function ordinalToMonth(ordinal) {
  return { year: Math.floor(ordinal / 12), month: (ordinal % 12) + 1 };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function rootUrl() {
  const currentRoot = new URL("/", window.location.origin);
  const canonicalHref = document.querySelector('link[rel="canonical"]')?.href;

  // The legacy Vercel origin is still reachable, including from older PWAs.
  // Keep local and preview builds self-contained, but never let that retired
  // production host leak back into newly shared results or challenges.
  if (currentRoot.hostname === "fjale-self.vercel.app" && canonicalHref) {
    return new URL("/", canonicalHref).toString();
  }

  return currentRoot.toString();
}

function playSound(kind) {
  if (!preferences.sound) {
    return;
  }

  const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
  if (!AudioContextClass) {
    return;
  }

  audioContext ??= new AudioContextClass();
  if (audioContext.state === "suspended") {
    audioContext.resume();
  }

  const patterns = {
    key: [[420, 0, 0.045]],
    submit: [[360, 0, 0.055], [460, 0.055, 0.07]],
    hint: [[520, 0, 0.08], [660, 0.07, 0.09]],
    error: [[210, 0, 0.11]],
    win: [[440, 0, 0.11], [554, 0.08, 0.13], [659, 0.17, 0.17]],
  };
  const now = audioContext.currentTime;

  for (const [frequency, delay, duration] of patterns[kind] ?? patterns.key) {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, now + delay);
    gain.gain.exponentialRampToValueAtTime(0.055, now + delay + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + duration);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(now + delay);
    oscillator.stop(now + delay + duration + 0.01);
  }
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator && window.isSecureContext) {
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("/service-worker.js")
        .then((registration) => watchForWaitingUpdate(registration))
        .catch(() => {
          // Offline support is an enhancement; gameplay does not depend on it.
        });
    });
  }
}

// A new deploy installs an updated worker that then waits until every tab
// closes — players on a long-lived tab or installed PWA would stay on the old
// version indefinitely. Surface the waiting worker as a prompt instead:
// accepting it activates the new worker, whose versioned cache replaces the
// old one, so a single ordinary reload delivers the fresh app. Nobody has to
// clear caches or hard-refresh.
function watchForWaitingUpdate(registration) {
  updateRegistration = registration;

  const offerWhenInstalled = (worker) => {
    if (!worker) {
      return;
    }
    worker.addEventListener("statechange", () => {
      if (worker.state === "installed" && navigator.serviceWorker.controller) {
        showUpdatePrompt();
      }
    });
  };

  // The controller check keeps the very first install silent: with no previous
  // worker there is nothing stale to refresh away from.
  if (registration.waiting && navigator.serviceWorker.controller) {
    showUpdatePrompt();
  }
  offerWhenInstalled(registration.installing);
  registration.addEventListener("updatefound", () => offerWhenInstalled(registration.installing));

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!updateReloadArmed) {
      return;
    }
    updateReloadArmed = false;
    window.location.reload();
  });

  // Long-lived tabs and installed PWAs rarely reload on their own; recheck for
  // a new worker whenever the player returns to the app.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      registration.update().catch(() => {});
    }
  });
}

function showUpdatePrompt() {
  if (!elements.updateBanner.hidden) {
    return;
  }
  elements.updateBanner.hidden = false;
  announce("Një version i ri i lojës është gati. Shtyp Rifresko për ta hapur.");
}

function acceptUpdate() {
  elements.updateRefresh.disabled = true;
  const waiting = updateRegistration?.waiting;
  if (waiting) {
    updateReloadArmed = true;
    waiting.postMessage({ type: "SKIP_WAITING" });
  } else {
    // The waiting worker already activated (another tab accepted first);
    // a plain reload is enough to pick it up.
    window.location.reload();
  }
}
