// app.js: switches screens, runs the game, handles the keypad.

// shorthand for grabbing an element by its id
const $ = (id) => document.getElementById(id);

// localStorage only stores strings, so values go through JSON (like python's json module).
// try/catch because some private-browsing modes block storage.
function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

// ---------- modes ----------

// every preset is a mode + a value + a problem mix. that combination is
// what stats get grouped by later, so results are always comparable.
const MODES = {
  timed:  { desc: "classic mix · highest score wins",             unit: "seconds", values: [150, 300, 500], mix: "classic" },
  sprint: { desc: "classic mix · fastest time wins · skip = +5s", unit: "correct", values: [20, 50, 100],   mix: "classic" },
  quant:  { desc: "everything mixed · highest score wins",        unit: "seconds", values: [480],           mix: "quant" },
};

const SKIP_PENALTY_MS = 5000;

// everything about the current game lives in one object
const state = {
  mode: load("mode", "timed"),
  value: load("value", 150),
  score: 0,
  skips: 0,
  input: "",      // what you've typed so far, e.g. "-12"
  problem: null,  // the current problem object from problems.js
  shownAt: 0,     // when the current problem appeared (ms)
  startedAt: 0,   // when the game started (ms)
  penaltyMs: 0,   // sprint skip penalties added so far
  log: [],        // one entry per problem: { text, op, ms, skipped }
  timerId: null,
};

// in case a saved mode/value no longer exists
if (!MODES[state.mode] || !MODES[state.mode].values.includes(state.value)) {
  state.mode = "timed";
  state.value = 150;
}

const isSprint = () => state.mode === "sprint";

// every saved game, kept in memory so the stats screen (and export) don't
// have to wait on the database
let games = [];

// ---------- screens ----------

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => {
    s.classList.toggle("active", s.id === id);
  });
}

// ---------- home ----------

// your best result in one preset, or null if you haven't played it.
// (presetKey, result and isSprintKey live in stats.js)
function bestFor(key) {
  const results = games.filter((g) => presetKey(g) === key).map(result);
  if (!results.length) return null;
  return isSprintKey(key) ? Math.min(...results) : Math.max(...results);
}

// builds the tabs and mode buttons from MODES, so adding a preset is a one-line change
function renderHome() {
  $("tabs").innerHTML = Object.keys(MODES)
    .map((m) => `<button class="tab ${m === state.mode ? "on" : ""}" data-mode="${m}">${m}</button>`)
    .join("");

  const mode = MODES[state.mode];
  $("mode-desc").textContent = mode.desc;
  $("mode-list").innerHTML = mode.values
    .map((v) => {
      const key = `${state.mode}-${v}`;
      const best = bestFor(key);
      return `<button class="mode ${v === state.value ? "selected" : ""}" data-value="${v}">
        <span>${v} ${mode.unit}</span>
        <span class="mode-best">${best === null ? "" : `best ${formatResult(key, best)}`}</span>
      </button>`;
    })
    .join("");

  const streak = currentStreak();
  const playedToday = games.some((g) => dayKey(g.date) === dayKey(new Date()));
  $("home-streak").textContent =
    streak === 0 ? "play a game to start a streak"
    : `${streak} day streak` + (playedToday ? "" : " · play today to keep it");
}

// one listener on the parent handles every button inside it ("event delegation")
$("tabs").addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  state.mode = btn.dataset.mode;
  state.value = MODES[state.mode].values[0];
  save("mode", state.mode);
  save("value", state.value);
  renderHome();
});

$("mode-list").addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  state.value = Number(btn.dataset.value);
  save("value", state.value);
  renderHome();
});

// on/off settings. each one is independent, so any combination works.
const SETTINGS = {
  showHud: load("showHud", true),     // timer and score in game
  showBar: load("showBar", true),     // progress bar in game
  showBests: load("showBests", true), // best scores on home and results
};

// each setting that's off puts a class on <body>, e.g. "off-showBests".
// style.css decides what each class hides, so one setting can hide
// several things on different screens.
function renderToggles() {
  for (const [key, on] of Object.entries(SETTINGS)) {
    document.body.classList.toggle(`off-${key}`, !on);
  }
  document.querySelectorAll(".toggle").forEach((btn) => {
    btn.querySelector(".switch").classList.toggle("on", SETTINGS[btn.dataset.setting]);
  });
}

document.querySelectorAll(".toggle").forEach((btn) => {
  btn.addEventListener("click", () => {
    const key = btn.dataset.setting;
    SETTINGS[key] = !SETTINGS[key];
    save(key, SETTINGS[key]);
    renderToggles();
  });
});

$("start").addEventListener("click", startGame);
$("again").addEventListener("click", startGame);
// ---------- navigation ----------

function goHome() {
  renderHome();
  showScreen("home");
}

// renderStats() lives in stats.js
function openStats() {
  renderStats();
  showScreen("stats");
  $("stats").scrollTop = 0;
}

$("home-btn").addEventListener("click", goHome);
$("stats-btn").addEventListener("click", openStats);
$("results-stats").addEventListener("click", openStats);
$("stats-back").addEventListener("click", goHome);
$("settings-btn").addEventListener("click", () => showScreen("settings"));
$("settings-back").addEventListener("click", goHome);

// ---------- saved data ----------

function renderSavedCount() {
  $("saved-count").textContent = games.length;
}

// shows a short message under the export/import buttons for a few seconds
let statusTimer = null;
function setDataStatus(text) {
  $("data-status").textContent = text;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => ($("data-status").textContent = ""), 4000);
}

$("export-btn").addEventListener("click", () => {
  exportGames(games)
    .then(() => setDataStatus("exported"))
    .catch((err) => {
      if (err.name !== "AbortError") setDataStatus("export failed"); // AbortError = you closed the share sheet
    });
});

// the real file picker is a hidden <input>; the import button just clicks it
$("import-btn").addEventListener("click", () => $("import-file").click());

$("import-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = ""; // so picking the same file again still fires "change"
  if (!file) return;

  try {
    const { added, skipped } = await importGames(file);
    games = await loadGames();
    renderSavedCount();
    setDataStatus(`imported ${added}` + (skipped ? ` · ${skipped} already saved` : ""));
  } catch (err) {
    console.error(err);
    setDataStatus("that file isn't an alphamac backup");
  }
});

// delete needs two taps, like quit, and says how many games will go
let deleteArmed = false;
let deleteTimer = null;

function disarmDelete() {
  clearTimeout(deleteTimer);
  deleteArmed = false;
  $("delete-label").textContent = "delete all games";
}

$("delete-btn").addEventListener("click", async () => {
  if (!games.length) return setDataStatus("nothing to delete");

  if (!deleteArmed) {
    deleteArmed = true;
    $("delete-label").textContent = `tap again to delete ${games.length} ${games.length === 1 ? "game" : "games"}`;
    deleteTimer = setTimeout(disarmDelete, 3000);
    return;
  }

  disarmDelete();
  try {
    await clearGames();
    games = [];
    renderSavedCount();
    setDataStatus("all games deleted");
  } catch (err) {
    console.error(err);
    setDataStatus("couldn't delete games");
  }
});

// ---------- startup ----------

// DOMContentLoaded fires after every <script> has run, so functions from
// stats.js (which loads after this file) exist by then
document.addEventListener("DOMContentLoaded", () => {
  renderHome();
  renderToggles();

  // offline support (sw.js). skipped on your own computer, where caching
  // would hide your edits; add ?sw to the address to test it there anyway.
  const local = ["localhost", "127.0.0.1"].includes(location.hostname);
  if ("serviceWorker" in navigator && (!local || location.search.includes("sw"))) {
    navigator.serviceWorker.register("sw.js").catch((err) => console.error(err));
  }

  loadGames()
    .then((saved) => {
      games = saved;
      renderSavedCount();
      renderHome();
    })
    .catch((err) => {
      console.error(err);
      setDataStatus("couldn't open saved games");
    });
});

// ---------- time formatting ----------

// 150000 → "2:30" (rounds up, for countdowns)
function formatClock(ms) {
  const secs = Math.ceil(ms / 1000);
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}

// 83400 → "1:23.4" (for sprint times)
function formatStopwatch(ms) {
  const tenths = Math.floor(ms / 100);
  const m = Math.floor(tenths / 600);
  const s = ((tenths % 600) / 10).toFixed(1).padStart(4, "0");
  return `${m}:${s}`;
}

// ---------- game loop ----------

function startGame() {
  state.score = 0;
  state.skips = 0;
  state.penaltyMs = 0;
  state.log = [];
  state.startedAt = performance.now();
  $("score").textContent = "0";
  disarmQuit();

  showScreen("game");
  nextProblem();
  tick();
  state.timerId = setInterval(tick, 100); // run tick() every 100 ms
}

function elapsedMs() {
  return performance.now() - state.startedAt + state.penaltyMs;
}

function nextProblem() {
  state.problem = makeProblem(MODES[state.mode].mix);
  state.input = "";
  state.shownAt = performance.now();
  $("problem").textContent = state.problem.text;
  $("problem").classList.toggle("long", state.problem.text.length > 10);
  renderInput();
}

function tick() {
  if (isSprint()) {
    // sprint counts up; the bar fills as you get closer to the target
    $("timer").textContent = formatStopwatch(elapsedMs());
    $("bar-fill").style.transform = `scaleX(${state.score / state.value})`;
    return;
  }

  // timed counts down; the bar empties
  const left = state.value * 1000 - elapsedMs();
  if (left <= 0) return endGame();
  $("timer").textContent = formatClock(left);
  $("bar-fill").style.transform = `scaleX(${left / (state.value * 1000)})`;
}

function endGame() {
  clearInterval(state.timerId);

  const key = `${state.mode}-${state.value}`;
  const sprint = isSprint();
  const thisResult = sprint ? elapsedMs() / 1000 : state.score;

  // compare against earlier games in this preset (before this one is added)
  const previous = games.filter((g) => presetKey(g) === key).map(result);
  const prevBest = previous.length ? (sprint ? Math.min(...previous) : Math.max(...previous)) : null;
  const isBest = prevBest !== null && (sprint ? thisResult < prevBest : thisResult > prevBest);

  storeGame();

  $("final-label").textContent = sprint ? `time for ${state.value}` : "score";
  countUp($("final-score"), thisResult, (x) => (sprint ? formatStopwatch(x * 1000) : Math.round(x)));

  $("final-badge").textContent =
    previous.length === 0 ? "first game in this mode" : isBest ? "new best" : "";
  $("final-compare").textContent = previous.length
    ? `your average ${formatResult(key, mean(previous))} · best ${formatResult(key, prevBest)}`
    : "";

  const solved = state.log.filter((p) => !p.skipped);
  const totalMs = solved.reduce((sum, p) => sum + p.ms, 0);
  const avg = solved.length ? (totalMs / solved.length / 1000).toFixed(2) : "–";
  const skipWord = state.skips === 1 ? "skip" : "skips";
  const penalty = sprint && state.skips ? ` (+${state.skips * 5}s)` : "";
  $("final-detail").textContent = `${avg}s per question · ${state.skips} ${skipWord}${penalty}`;

  // your three slowest answers this game
  const slowest = [...solved].sort((a, b) => b.ms - a.ms).slice(0, 3);
  $("final-slowest-panel").classList.toggle("off", !slowest.length);
  $("final-slowest").innerHTML = slowest
    .map((p) => `<div class="slow-row"><span>${p.text}</span><span style="color:${speedColor(p.ms / 1000)}">${(p.ms / 1000).toFixed(1)}s</span></div>`)
    .join("");

  showScreen("results");
}

// counts a number up from 0 over 0.7s, fast at first then easing in
function countUp(el, target, format) {
  const start = performance.now();
  const duration = 700;
  function frame(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = format(target * eased);
    if (t < 1) requestAnimationFrame(frame); // ask the browser to call frame() again next screen refresh
  }
  requestAnimationFrame(frame);
}

// ---------- quitting ----------

// two taps to quit, so a stray tap doesn't throw away a 500-second game.
// quit games aren't saved, so they never drag your averages down.
let quitArmed = false;
let quitTimer = null;

function disarmQuit() {
  clearTimeout(quitTimer);
  quitArmed = false;
  $("quit").textContent = "×";
  $("quit").classList.remove("armed");
}

function quitGame() {
  clearInterval(state.timerId);
  disarmQuit();
  goHome();
}

$("quit").addEventListener("pointerdown", (e) => {
  e.preventDefault();
  if (quitArmed) return quitGame();
  quitArmed = true;
  $("quit").textContent = "quit?";
  $("quit").classList.add("armed");
  quitTimer = setTimeout(disarmQuit, 2500); // forget the first tap after 2.5s
});

// one saved game. mode + value + mix together say which preset it was,
// so stats only ever compare like with like.
function storeGame() {
  const game = {
    date: new Date().toISOString(), // when it ended, e.g. "2026-10-22T18:04:31.120Z"
    mode: state.mode,
    value: state.value,
    mix: MODES[state.mode].mix,
    score: state.score,
    skips: state.skips,
    timeMs: Math.round(elapsedMs()), // includes sprint skip penalties
    problems: state.log,
  };

  requestPersistence();
  saveGame(game)
    .then((id) => {
      game.id = id;
      games.push(game);
      renderSavedCount();
    })
    .catch((err) => {
      console.error(err);
      setDataStatus("couldn't save that game");
    });
}

// saves how long the current problem took
function record(skipped) {
  state.log.push({
    text: state.problem.text,
    op: state.problem.op,
    a: state.problem.a,
    b: state.problem.b,
    ms: Math.round(performance.now() - state.shownAt),
    skipped,
  });
}

// ---------- input ----------

function press(key) {
  if (key === "skip") {
    record(true);
    state.skips++;
    if (isSprint()) state.penaltyMs += SKIP_PENALTY_MS;
    return nextProblem();
  }

  if (key === "back") {
    state.input = state.input.slice(0, -1); // like python's s[:-1]
  } else if (key === "-") {
    // minus toggles the sign, wherever you are in the number
    state.input = state.input.startsWith("-") ? state.input.slice(1) : "-" + state.input;
  } else if (state.input.length < 10) {
    state.input += key;
  }

  renderInput();

  // zetamac-style: move on the moment the answer is right
  if (isCorrect(state.input, state.problem)) {
    record(false);
    state.score++;
    $("score").textContent = state.score;

    if (isSprint() && state.score >= state.value) return endGame();
    nextProblem();
  }
}

function renderInput() {
  $("answer").textContent = state.input.replace("-", "−");
}

// pointerdown fires the instant your finger lands, faster than "click"
$("keypad").addEventListener("pointerdown", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  e.preventDefault();
  btn.classList.add("down");
  setTimeout(() => btn.classList.remove("down"), 90);
  press(btn.dataset.key);
});

// a real keyboard works too, handy for testing on a computer
document.addEventListener("keydown", (e) => {
  if (!$("game").classList.contains("active")) return;
  if (/^[0-9./-]$/.test(e.key)) press(e.key);
  else if (e.key === "Backspace") press("back");
  else if (e.key === " ") press("skip");
  else if (e.key === "Escape") quitGame();
});
