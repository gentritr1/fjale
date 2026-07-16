import {
  ALBANIAN_ALPHABET,
  ALBANIAN_DIGRAPHS,
  appendPhysicalCharacter,
  createChallengeCode,
  decodeChallengeCode,
  evaluateGuess,
  formatDuration,
  getDailyIndex,
  getTiranaDateKey,
  normalizeWord,
  removeLastToken,
  sanitizeDailyResults,
  secondsUntilNextTiranaDay,
  tokenizeAlbanian,
} from "./game.js";
import { ACCEPTED_GUESSES, ANSWERS } from "./words.js";

const ROW_COUNT = 6;
const COLUMN_COUNT = 5;
const HINT_UNLOCK_GUESS = 3;
// Version 1 of the published daily pool is immutable. New words may be
// appended for practice without changing earlier daily puzzles or challenges.
const DAILY_POOL_SIZE = 62;
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
const SHARE_MARK = Object.freeze({ absent: "⬛×", present: "🟨•", correct: "🟩✓" });
const DIGRAPH_SET = new Set(ALBANIAN_DIGRAPHS);
const ALPHABET_SET = new Set(ALBANIAN_ALPHABET);
const ANSWER_SET = new Set(ANSWERS.map((entry) => entry.word));
const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)");

const KEYBOARD_ROWS = Object.freeze([
  ["q", "e", "r", "rr", "t", "th", "y", "u", "i", "o"],
  ["p", "ç", "a", "s", "sh", "d", "dh", "f", "g", "gj"],
  ["h", "j", "k", "l", "ll", "ë", "z", "zh", "x", "xh"],
  ["enter", "c", "v", "b", "n", "nj", "m", "backspace"],
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
  hintCard: document.querySelector("#hint-card"),
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
  resultLabel: document.querySelector("#result-label"),
  resultMeta: document.querySelector("#result-meta"),
  resultPanel: document.querySelector("#result-panel"),
  resultTime: document.querySelector("#result-time"),
  resultWord: document.querySelector("#result-word"),
  screenReaderStatus: document.querySelector("#screen-reader-status"),
  shareButton: document.querySelector("#share-button"),
  soundToggle: document.querySelector("#sound-toggle"),
  statBesa: document.querySelector("#stat-besa"),
  statBest: document.querySelector("#stat-best"),
  statPlayed: document.querySelector("#stat-played"),
  statStreak: document.querySelector("#stat-streak"),
  statWinRate: document.querySelector("#stat-win-rate"),
  themeSelect: document.querySelector("#theme-select"),
  toast: document.querySelector("#toast"),
};

let preferences = loadPreferences();
let profile = loadProfile();
let primaryDescriptor = createPrimaryDescriptor();
let state = loadGame(primaryDescriptor);
let animatingRow = null;
let isAnimating = false;
let invalidPulse = false;
let toastTimer = null;
let invalidTimer = null;
let revealTimer = null;
let countdownTimer = null;
let calendarView = null;
let audioContext = null;

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
  const challengeIndex = challengeCode
    ? decodeChallengeCode(challengeCode, ANSWERS.length)
    : null;

  if (challengeIndex !== null) {
    const canonicalCode = createChallengeCode(challengeIndex);
    return {
      mode: "challenge",
      answerIndex: challengeIndex,
      puzzleId: `challenge-${canonicalCode}`,
      challengeCode: canonicalCode,
    };
  }

  const now = new Date();
  const dateKey = getTiranaDateKey(now);
  return {
    mode: "daily",
    answerIndex: getDailyIndex(now, DAILY_POOL_SIZE),
    puzzleId: `daily-${dateKey}`,
    dateKey,
  };
}

function createArchiveDescriptor(dateKey) {
  // Noon UTC always resolves to the same Tirana calendar date, so the archive
  // word matches the daily word that was published on that date.
  const date = new Date(`${dateKey}T12:00:00Z`);
  return {
    mode: "archive",
    answerIndex: getDailyIndex(date, DAILY_POOL_SIZE),
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
    answerIndex < 0 ||
    answerIndex >= ANSWERS.length ||
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

  const guesses = Array.isArray(raw.guesses)
    ? raw.guesses.slice(0, ROW_COUNT).map(validateTokenRow).filter(Boolean)
    : [];
  const current = validateCurrentRow(raw.current);
  const answerTokens = tokenizeAlbanian(ANSWERS[answerIndex].word);
  const winningIndex = guesses.findIndex((guess) => tokensEqual(guess, answerTokens));
  const normalizedGuesses = winningIndex >= 0 ? guesses.slice(0, winningIndex + 1) : guesses;
  const status = winningIndex >= 0 ? "won" : normalizedGuesses.length >= ROW_COUNT ? "lost" : "playing";

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
    usedHint: Boolean(raw.usedHint),
    besa: Boolean(raw.besa),
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
  elements.hintButton.addEventListener("click", revealHint);
  elements.besaButton.addEventListener("click", toggleBesa);
  elements.keyboard.addEventListener("click", handleKeyboardClick);
  elements.shareButton.addEventListener("click", shareResult);
  elements.challengeButton.addEventListener("click", shareChallenge);
  elements.replayButton.addEventListener("click", startNewPractice);
  elements.calendarPrev.addEventListener("click", () => shiftCalendar(-1));
  elements.calendarNext.addEventListener("click", () => shiftCalendar(1));
  elements.calendarBody.addEventListener("click", handleCalendarClick);
  document.addEventListener("keydown", handlePhysicalKeyboard);
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
  }
}

function gameProgress(game) {
  const completion = game.status === "playing" ? 0 : 1_000;
  const flags = Number(game.besa) + Number(game.usedHint);
  return completion + game.guesses.length * 10 + game.current.length * 2 + flags;
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
  animatingRow = null;
  isAnimating = false;
  invalidPulse = false;
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
    submitGuess();
  } else if (value === "backspace") {
    removeLetter();
  } else {
    inputLetter(value);
  }
}

function handlePhysicalKeyboard(event) {
  if (
    event.defaultPrevented ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    document.querySelector("dialog[open]") ||
    ["INPUT", "SELECT", "TEXTAREA"].includes(event.target.tagName)
  ) {
    return;
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

  if (/^[a-zçë]$/iu.test(event.key)) {
    event.preventDefault();
    inputLetter(event.key);
  }
}

function inputLetter(letter) {
  if (!ensureCurrentDailyPuzzle() || state.status !== "playing" || isAnimating) {
    return;
  }

  const before = state.current;
  const normalized = normalizeWord(letter);
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

  state.current = removeLastToken(state.current);
  persistGame();
  resetBoardMessage();
  renderBoard();
  playSound("key");
}

function submitGuess() {
  if (!ensureCurrentDailyPuzzle() || state.status !== "playing" || isAnimating) {
    return;
  }

  if (state.current.length !== COLUMN_COUNT) {
    showInvalid(`Duhet një fjalë me ${COLUMN_COUNT} shkronja shqip.`);
    return;
  }

  const guessWord = state.current.join("");
  if (!ACCEPTED_GUESSES.has(guessWord) && !ANSWER_SET.has(guessWord)) {
    showInvalid("S’e gjejmë në fjalor. Provo një formë tjetër.");
    return;
  }

  const answerTokens = getAnswerTokens();
  const guessTokens = [...state.current];
  const statuses = evaluateGuess(answerTokens, guessTokens);
  state.guesses.push(guessTokens);
  state.current = [];
  state.startedAt ??= Date.now();

  if (statuses.every((status) => status === "correct")) {
    state.status = "won";
    state.completedAt = Date.now();
  } else if (state.guesses.length >= ROW_COUNT) {
    state.status = "lost";
    state.completedAt = Date.now();
  }

  persistGame();
  isAnimating = true;
  animatingRow = state.guesses.length - 1;
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
    announce(`Prova ${state.guesses.length}. ${announcement}`);

    if (state.status === "playing") {
      renderAll();
      return;
    }

    finishGame();
  }, revealDuration);
}

function finishGame() {
  recordCompletedGame();
  persistGame();
  renderAll();
  elements.resultPanel.focus({ preventScroll: true });

  if (state.status === "won") {
    playSound("win");
    showCelebration();
    announce(`E gjete fjalën ${getAnswer().word} në ${state.guesses.length} prova.`);
  } else {
    playSound("error");
    announce(`Loja mbaroi. Fjala ishte ${getAnswer().word}.`);
  }

  if (window.matchMedia("(max-width: 880px)").matches) {
    window.setTimeout(() => {
      elements.resultPanel.scrollIntoView({
        block: "start",
        behavior: REDUCED_MOTION.matches ? "auto" : "smooth",
      });
    }, REDUCED_MOTION.matches ? 0 : 420);
  }
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

function revealHint() {
  if (state.status !== "playing") {
    showToast("Kjo lojë ka përfunduar.");
    return;
  }

  if (state.besa) {
    showToast("Ke dhënë Besën: kjo lojë luhet pa gjurmë.");
    return;
  }

  if (state.usedHint) {
    showToast("Gjurmën e ke tashmë të hapur.");
    return;
  }

  if (state.guesses.length < HINT_UNLOCK_GUESS) {
    const remaining = HINT_UNLOCK_GUESS - state.guesses.length;
    showToast(`Gjurmë pas ${remaining} ${remaining === 1 ? "prove" : "provash"} të tjera.`);
    return;
  }

  state.usedHint = true;
  persistGame();
  renderMeta();
  setBoardMessage("Gjurmë e hapur — rezultati do ta tregojë përdorimin e saj.");
  showToast("Gjurmë e hapur.");
  playSound("hint");
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

function renderMeta() {
  const answer = getAnswer();
  const attemptsUntilHint = Math.max(0, HINT_UNLOCK_GUESS - state.guesses.length);

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
      : attemptsUntilHint > 0
        ? String(attemptsUntilHint)
        : "!";
  elements.hintButton.disabled = state.status !== "playing";
  elements.hintButton.setAttribute("aria-expanded", String(state.usedHint));
  elements.besaButton.disabled = state.status !== "playing";
  elements.besaButton.setAttribute("aria-pressed", String(state.besa));
  elements.hintCard.classList.toggle("is-revealed", state.usedHint);
  elements.besaCard.classList.toggle("is-active", state.besa);

  if (state.usedHint) {
    elements.hintDescription.textContent = `${answer.partOfSpeech} · ${answer.syllables}`;
    elements.hintCopy.textContent = answer.clue;
  } else if (state.besa) {
    elements.hintDescription.textContent = "E mbyllur nga Besa.";
    elements.hintCopy.textContent = "Këtë raund do ta zgjidhësh vetëm me provat e tua.";
  } else if (attemptsUntilHint > 0) {
    elements.hintDescription.textContent = `Hapet pas ${attemptsUntilHint} ${attemptsUntilHint === 1 ? "prove" : "provash"}.`;
    elements.hintCopy.textContent = "Do të tregojë kuptimin pa zbuluar asnjë shkronjë.";
  } else {
    elements.hintDescription.textContent = "Gati kur të duash.";
    elements.hintCopy.textContent = "Një shtysë e vogël, pa zbuluar shkronjat.";
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

  for (let rowIndex = 0; rowIndex < ROW_COUNT; rowIndex += 1) {
    const row = document.createElement("div");
    row.className = "board-row";
    row.setAttribute("role", "row");
    row.setAttribute("aria-rowindex", String(rowIndex + 1));

    const submittedGuess = state.guesses[rowIndex] ?? null;
    const isCurrentRow = rowIndex === state.guesses.length && state.status === "playing";
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
      tile.setAttribute(
        "aria-label",
        `Rreshti ${rowIndex + 1}, kutia ${columnIndex + 1}: ${letterLabel}${statusLabel}`,
      );
      row.append(tile);
    }

    elements.board.append(row);
  }
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

    for (const value of keys) {
      const key = document.createElement("button");
      key.type = "button";
      key.className = "key";
      key.dataset.key = value;
      key.disabled = state.status !== "playing" || isAnimating;

      if (value === "enter") {
        key.classList.add("is-wide");
        key.setAttribute("aria-label", "Provo fjalën");
        key.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M20 5v7H6"></path><path d="m10 8-4 4 4 4"></path></svg>';
      } else if (value === "backspace") {
        key.classList.add("is-wide");
        key.setAttribute("aria-label", "Fshi shkronjën e fundit");
        key.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m9 7-5 5 5 5h10V7z"></path><path d="m12 10 4 4M16 10l-4 4"></path></svg>';
      } else {
        key.textContent = value.toLocaleUpperCase("sq-AL");
        key.setAttribute("aria-label", `Shkronja ${value.toLocaleUpperCase("sq-AL")}`);
        const status = keyStatuses.get(value);
        if (status) {
          key.classList.add(`is-${status}`);
          key.setAttribute("aria-label", `${key.getAttribute("aria-label")}, ${STATUS_LABEL[status]}`);
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

  if (!isComplete) {
    return;
  }

  const answer = getAnswer();
  const answerTokens = getAnswerTokens();
  const digraphs = [...new Set(answerTokens.filter((token) => DIGRAPH_SET.has(token)))];
  const won = state.status === "won";
  const besaEarned = won && state.besa && !state.usedHint;

  elements.resultLabel.textContent = won
    ? `E gjete në ${state.guesses.length} ${state.guesses.length === 1 ? "provë" : "prova"}${besaEarned ? " · Besa ✓" : ""}`
    : "Fjala ishte";
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

function renderStats() {
  const winRate = profile.played > 0 ? Math.round((profile.won / profile.played) * 100) : 0;
  elements.statPlayed.textContent = String(profile.played);
  elements.statWinRate.textContent = `${winRate}%`;
  elements.statStreak.textContent = String(profile.currentStreak);
  elements.statBest.textContent = String(profile.bestStreak);
  elements.statBesa.textContent = String(profile.besaWins);

  const maxValue = Math.max(1, ...profile.distribution);
  elements.distribution.replaceChildren();
  profile.distribution.forEach((value, index) => {
    const row = document.createElement("div");
    row.className = "distribution-row";
    row.classList.toggle("is-current", profile.lastWinGuesses === index + 1);

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
    elements.distribution.append(row);
  });

  renderCalendar();
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
  // (completedPuzzles is capped at 500, so this guard is partial by design.)
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

  if (profile.completedPuzzles.includes(state.puzzleId)) {
    state.recorded = true;
    return;
  }

  profile.played += 1;
  profile.completedPuzzles.push(state.puzzleId);
  profile.completedPuzzles = profile.completedPuzzles.slice(-500);

  if (state.status === "won") {
    profile.won += 1;
    profile.distribution[state.guesses.length - 1] += 1;
    profile.lastWinGuesses = state.guesses.length;
    profile.collection = [
      ...new Set([...profile.collection, ...getAnswerTokens()]),
    ].filter((letter) => ALPHABET_SET.has(letter));

    if (state.besa && !state.usedHint) {
      profile.besaWins += 1;
    }
  }

  if (state.mode === "daily") {
    if (state.status === "won") {
      const currentKey = state.puzzleId.replace("daily-", "");
      const dayDifference = profile.lastDailyWin
        ? dateKeyOrdinal(currentKey) - dateKeyOrdinal(profile.lastDailyWin)
        : null;
      profile.currentStreak = dayDifference === 1 ? profile.currentStreak + 1 : 1;
      profile.bestStreak = Math.max(profile.bestStreak, profile.currentStreak);
      profile.lastDailyWin = currentKey;
    } else {
      profile.currentStreak = 0;
    }
  }

  // Archive games contribute to the calendar history but never to the streak,
  // which the mode gate above already guarantees.
  const trackedDate = trackedResultDate();
  if (trackedDate) {
    profile.dailyResults[trackedDate] = state.status === "won" ? state.guesses.length : "X";
  }

  state.recorded = true;
  saveProfile();
}

function trackedResultDate() {
  const key =
    state.mode === "daily"
      ? state.puzzleId.replace("daily-", "")
      : state.mode === "archive"
        ? state.puzzleId.replace("archive-", "")
        : null;

  return key && /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : null;
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

  const score = state.status === "won" ? state.guesses.length : "X";
  const puzzleLabel =
    state.mode === "daily"
      ? `#${state.puzzleId.replace("daily-", "")}`
      : state.mode === "archive"
        ? `#${state.puzzleId.replace("archive-", "")} (arkiv)`
        : state.mode === "challenge"
          ? "Sfidë"
          : "Pa fund";
  const badges = [
    state.besa && !state.usedHint && state.status === "won" ? "🛡 Besa" : null,
    state.usedHint ? "💡 me gjurmë" : null,
  ].filter(Boolean);
  const grid = state.guesses
    .map((guess) =>
      evaluateGuess(getAnswerTokens(), guess)
        .map((status) => SHARE_MARK[status])
        .join(""),
    )
    .join("\n");
  const text = [
    `FJALË ${puzzleLabel} ${score}/${ROW_COUNT} · ${formatDuration(elapsedSeconds())}`,
    badges.join(" · "),
    "",
    grid,
    "",
    "✓ në vend · • diku tjetër · × jo",
  ]
    .filter((line, index, lines) => line !== "" || lines[index - 1] !== "")
    .join("\n");

  await shareOrCopy({
    title: "Rezultati im në FJALË",
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
    return { text: "Gjurmë e hapur — vazhdo me provën tjetër.", tone: "" };
  }
  return { text: "Dyshkronjëshat si SH dhe RR zënë vetëm një kuti.", tone: "" };
}

function resetBoardMessage() {
  const message = renderDefaultBoardMessage();
  setBoardMessage(message.text, message.tone);
}

function setBoardMessage(text, tone = "") {
  elements.boardMessage.textContent = text;
  elements.boardMessage.classList.toggle("is-error", tone === "error");
  elements.boardMessage.classList.toggle("is-success", tone === "success");
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => elements.toast.classList.remove("is-visible"), 2400);
  announce(message);
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
  return ANSWERS[state.answerIndex];
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

function randomAnswerIndex(excludedIndex) {
  if (ANSWERS.length <= 1) {
    return 0;
  }

  let index = excludedIndex;
  while (index === excludedIndex) {
    if (window.crypto?.getRandomValues) {
      const value = new Uint32Array(1);
      window.crypto.getRandomValues(value);
      index = value[0] % ANSWERS.length;
    } else {
      index = Math.floor(Math.random() * ANSWERS.length);
    }
  }
  return index;
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
    ? saved.completedPuzzles.filter((id) => typeof id === "string").slice(-500)
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
  return new URL("/", window.location.origin).toString();
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
      navigator.serviceWorker.register("/service-worker.js").catch(() => {
        // Offline support is an enhancement; gameplay does not depend on it.
      });
    });
  }
}
