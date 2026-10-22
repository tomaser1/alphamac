// stats.js: works out numbers from saved games and draws the stats screen.
// charts are plain svg built as strings, so there's no chart library to
// download and everything works offline.
//
// two kinds of stats:
//   score stats (cards, trend, best-score heatmap) only use the chosen preset,
//     because a 150s score and a 500s score can't be compared
//   problem stats (operations, times table, slowest) pool every mode,
//     because 17 × 43 is the same problem whichever mode it came up in

const DAY_MS = 24 * 60 * 60 * 1000;
const HEAT_WEEKS = 26;

const OP_LABELS = {
  add: "+", sub: "−", mul: "×", div: "÷",
  frac: "fractions", sqrt: "√", pct: "%", dec: "decimals", sq: "squares",
};

// longer names for the question-type dropdown
const OP_NAMES = {
  add: "+ addition", sub: "− subtraction", mul: "× multiplication", div: "÷ division",
  frac: "fractions", sqrt: "√ square roots", pct: "% percentages", dec: "decimals", sq: "squares",
};

// how each question type gets split up to find weak spots.
// bucket(p) returns [sortOrder, label]; problems with the same label are averaged together.
// × and ÷ use the times-table grid instead.
const fiftyBucket = (n) => {
  const lo = Math.min(150, Math.floor(n / 50) * 50);
  return [lo, lo === 0 ? "2–49" : lo === 150 ? "150–200" : `${lo}–${lo + 49}`];
};

const BREAKDOWNS = {
  add: [
    { title: "by bigger number", bucket: (p) => fiftyBucket(Math.max(Math.abs(p.a), Math.abs(p.b))) },
    { title: "with negatives", bucket: (p) => (p.a < 0 || p.b < 0 ? [1, "has a −"] : [0, "all +"]) },
  ],
  sub: [
    { title: "by bigger number", bucket: (p) => fiftyBucket(Math.max(p.a, p.b)) },
    { title: "by answer", bucket: (p) => (p.a - p.b < 0 ? [1, "below 0"] : [0, "0 or more"]) },
  ],
  frac: [
    { title: "by biggest denominator", bucket: (p) => {
      const d = Math.max(Number(p.a.split("/")[1]), Number(p.b.split("/")[1]));
      return [d, `${d}`];
    } },
    { title: "by sign", bucket: (p) => (p.text.includes("−") ? [1, "−"] : [0, "+"]) },
  ],
  sqrt: [
    { title: "by number under the root", bucket: (p) => {
      const lo = Math.min(400, Math.floor(p.a / 100) * 100); // 500 joins the 400s
      return [lo, lo === 0 ? "2–99" : lo === 400 ? "400–500" : `${lo}–${lo + 99}`];
    } },
  ],
  pct: [
    { title: "by percentage", bucket: (p) => [p.a, `${p.a}%`] },
  ],
  dec: [
    { title: "by operation", bucket: (p) => (p.text.includes("×") ? [0, "×"] : [1, "+"]) },
  ],
  sq: [
    { title: "by number", bucket: (p) => {
      const lo = 11 + Math.floor((p.a - 11) / 5) * 5;
      return [lo, `${lo}–${lo + 4}`];
    } },
  ],
};

// speed colours, fast to slow. max is in seconds.
const SPEED_STEPS = [
  { max: 2, color: "#8fe3a8" },
  { max: 3, color: "#4fb873" },
  { max: 4.5, color: "#c9c46a" },
  { max: 6, color: "#f0b37e" },
  { max: Infinity, color: "#e07a6a" },
];

const ACTIVITY_COLORS = ["#1b1e24", "#1f4a2e", "#2f7a49", "#4fb873", "#8fe3a8"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const RANGE_DAYS = { "7d": 7, "30d": 30, "1y": 365 };

// what the stats screen is currently showing
const view = {
  range: "30d",
  preset: null,   // e.g. "quant-480"
  heat: "games",  // or "best"
  type: "all",    // question type, e.g. "mul"
  from: "",       // custom range, "yyyy-mm-dd"
  to: "",
};

// ---------- small helpers ----------

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const presetKey = (g) => `${g.mode}-${g.value}`;
const isSprintKey = (key) => key.startsWith("sprint");
const speedColor = (sec) => SPEED_STEPS.find((s) => sec < s.max).color;

// like python's itertools.groupby, but into a dict of lists
function groupBy(list, keyFn) {
  const out = {};
  for (const x of list) (out[keyFn(x)] ||= []).push(x);
  return out;
}

function allPresets() {
  return Object.entries(MODES).flatMap(([mode, m]) =>
    m.values.map((v) => ({ key: `${mode}-${v}`, label: `${mode} · ${v} ${m.unit}` }))
  );
}

// local calendar day like "2026-10-22". (toISOString uses utc, which would
// put a late-night game on the wrong day.)
function dayKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// "2026-10-22" → "oct 22"
function shortDate(key) {
  const [, m, d] = key.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

// the number a game is judged by: seconds for sprint, score for the rest
function result(g) {
  return g.mode === "sprint" ? g.timeMs / 1000 : g.score;
}

function formatResult(key, x) {
  if (isSprintKey(key)) return formatStopwatch(x * 1000);
  return Number.isInteger(x) ? `${x}` : x.toFixed(1);
}

// ---------- time windows ----------

// [start, end) as timestamps
function rangeWindow() {
  if (view.range === "all") return [0, Infinity];
  if (view.range === "custom") {
    const start = view.from ? new Date(`${view.from}T00:00`).getTime() : 0;
    const end = view.to ? new Date(`${view.to}T00:00`).getTime() + DAY_MS : Infinity;
    return [start, end];
  }
  return [Date.now() - RANGE_DAYS[view.range] * DAY_MS, Infinity];
}

function inWindow(g, [start, end]) {
  const t = new Date(g.date).getTime();
  return t >= start && t < end;
}

// ---------- numbers ----------

function summarise(list) {
  if (!list.length) return null;
  const results = list.map(result);
  const solved = list.flatMap((g) => g.problems.filter((p) => !p.skipped));
  return {
    avg: mean(results),
    best: list[0].mode === "sprint" ? Math.min(...results) : Math.max(...results),
    count: list.length,
    perQ: solved.length ? mean(solved.map((p) => p.ms)) / 1000 : null,
  };
}

// consecutive days with at least one game, counting back from today.
// not having played yet today doesn't break the streak.
function currentStreak() {
  const played = new Set(games.map((g) => dayKey(g.date)));
  const d = startOfToday();
  if (!played.has(dayKey(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (played.has(dayKey(d))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

// ---------- drawing ----------

function renderStats() {
  const presets = allPresets();
  if (!view.preset) {
    view.preset = games.length ? presetKey(games[games.length - 1]) : `${state.mode}-${state.value}`;
  }

  $("range-tabs").innerHTML = ["7d", "30d", "1y", "all", "custom"]
    .map((r) => `<button class="tab ${r === view.range ? "on" : ""}" data-range="${r}">${r}</button>`)
    .join("");
  $("custom-range").classList.toggle("off", view.range !== "custom");

  $("preset-select").innerHTML = presets
    .map((p) => `<option value="${p.key}" ${p.key === view.preset ? "selected" : ""}>${p.label}</option>`)
    .join("");

  const streak = currentStreak();
  $("streak").textContent =
    `${streak} day streak · ${games.length} ${games.length === 1 ? "game" : "games"} total`;

  const win = rangeWindow();
  const inRange = games.filter((g) => inWindow(g, win));
  const mine = inRange.filter((g) => presetKey(g) === view.preset);

  renderCards(mine, win);
  renderTrend(mine);
  renderHeatmap();
  renderQuestions(inRange);
}

const card = (label, value, extra = "") =>
  `<div class="card"><div class="muted">${label}</div><div class="card-value">${value}</div>${extra}</div>`;

const emptyNote = (text) => `<p class="muted empty">${text}</p>`;

function renderCards(list, win) {
  const s = summarise(list);
  if (!s) {
    $("cards").innerHTML = emptyNote("no games for this mode in this range yet");
    return;
  }

  const sprint = isSprintKey(view.preset);

  // compare against the window just before this one, e.g. the 7 days before the last 7
  let delta = "";
  const days = RANGE_DAYS[view.range];
  if (days) {
    const prevWin = [win[0] - days * DAY_MS, win[0]];
    const prev = summarise(games.filter((g) => presetKey(g) === view.preset && inWindow(g, prevWin)));
    if (prev) {
      const diff = s.avg - prev.avg;
      const good = sprint ? diff < 0 : diff > 0; // in sprint, lower is better
      const amount = Math.abs(diff).toFixed(1) + (sprint ? "s" : "");
      delta = Math.abs(diff) < 0.05
        ? `<div class="delta">same as previous ${view.range}</div>`
        : `<div class="delta ${good ? "good" : "bad"}">${diff > 0 ? "+" : "−"}${amount} vs previous ${view.range}</div>`;
    }
  }

  $("cards").innerHTML =
    card(sprint ? "average time" : "average score", formatResult(view.preset, s.avg), delta) +
    card(sprint ? "best time" : "best score", formatResult(view.preset, s.best)) +
    card("games", s.count) +
    card("per question", s.perQ ? `${s.perQ.toFixed(2)}s` : "–");
}

function renderTrend(list) {
  const sprint = isSprintKey(view.preset);
  $("trend-label").textContent = sprint ? "daily average time · lower is better" : "daily average score";

  const byDay = groupBy(list, (g) => dayKey(g.date));
  const points = Object.keys(byDay).sort().map((day) => ({ day, y: mean(byDay[day].map(result)) }));
  $("trend").innerHTML = points.length
    ? lineChart(points, (v) => formatResult(view.preset, v))
    : emptyNote("play a game to start your trend line");
}

// label(v) turns a y value into axis text, e.g. 58 → "58" or 3.2 → "3.2s"
function lineChart(points, label) {
  const W = 320, H = 140, padL = 44, padR = 8, padT = 10, padB = 22;
  const ys = points.map((p) => p.y);
  let lo = Math.min(...ys);
  let hi = Math.max(...ys);
  if (lo === hi) { lo -= 1; hi += 1; }

  // map data to pixels. svg's y axis points down, hence the 1 − ...
  const x = (i) => points.length === 1 ? (padL + W - padR) / 2 : padL + (i / (points.length - 1)) * (W - padL - padR);
  const y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);

  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join(" ");
  const dots = points.length > 40 ? "" : points
    .map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.y).toFixed(1)}" r="2.5" class="dot"/>`)
    .join("");
  const first = shortDate(points[0].day);
  const last = shortDate(points[points.length - 1].day);
  const dates = points.length === 1
    ? `<text x="${x(0)}" y="${H - 4}" text-anchor="middle">${first}</text>`
    : `<text x="${padL}" y="${H - 4}">${first}</text>
       <text x="${W - padR}" y="${H - 4}" text-anchor="end">${last}</text>`;

  return `<svg viewBox="0 0 ${W} ${H}" class="chart">
    <line x1="${padL}" x2="${W - padR}" y1="${y(hi)}" y2="${y(hi)}" class="grid"/>
    <line x1="${padL}" x2="${W - padR}" y1="${y(lo)}" y2="${y(lo)}" class="grid"/>
    <text x="${padL - 6}" y="${y(hi) + 4}" text-anchor="end">${label(hi)}</text>
    <text x="${padL - 6}" y="${y(lo) + 4}" text-anchor="end">${label(lo)}</text>
    ${dates}
    <path d="${line}" class="line"/>
    ${dots}
  </svg>`;
}

// github-style grid: one column per week, monday at the top
function renderHeatmap() {
  const today = startOfToday();
  const mondayOffset = (today.getDay() + 6) % 7; // getDay() is 0 for sunday
  const start = new Date(today);
  start.setDate(today.getDate() - mondayOffset - (HEAT_WEEKS - 1) * 7);

  const byDay = groupBy(games, (g) => dayKey(g.date));
  const sprint = isSprintKey(view.preset);

  // first pass: a value per day
  const days = [];
  for (let i = 0; i < HEAT_WEEKS * 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = dayKey(d);
    const dayGames = byDay[key] || [];

    let value = null;
    if (view.heat === "games") {
      value = dayGames.length || null;
    } else {
      const results = dayGames.filter((g) => presetKey(g) === view.preset).map(result);
      if (results.length) value = sprint ? Math.min(...results) : Math.max(...results);
    }
    days.push({ key, future: d > today, value });
  }

  // second pass: turn values into colour levels 1–4
  const values = days.filter((d) => d.value !== null).map((d) => d.value);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const level = (v) => {
    if (v === null) return 0;
    if (view.heat === "games") return v >= 5 ? 4 : v >= 3 ? 3 : v;
    if (hi === lo) return 4;
    const t = sprint ? (hi - v) / (hi - lo) : (v - lo) / (hi - lo); // 0 = worst, 1 = best
    return 1 + Math.min(3, Math.floor(t * 4));
  };

  $("heatmap").innerHTML = days
    .map((d) => {
      if (d.future) return `<div class="cell"></div>`;
      const what = d.value === null ? "no games"
        : view.heat === "games" ? `${d.value} ${d.value === 1 ? "game" : "games"}`
        : `best ${formatResult(view.preset, d.value)}`;
      return `<div class="cell" style="background:${ACTIVITY_COLORS[level(d.value)]}" data-info="${shortDate(d.key)} · ${what}"></div>`;
    })
    .join("");
  $("heat-caption").textContent = "tap a day";
}

// ---------- questions section ----------

// everything below the "questions" heading follows the type dropdown
function renderQuestions(gamesInRange) {
  $("type-select").innerHTML =
    `<option value="all">all types</option>` +
    Object.entries(OP_NAMES)
      .map(([op, name]) => `<option value="${op}" ${op === view.type ? "selected" : ""}>${name}</option>`)
      .join("");

  // every problem in range, tagged with the day it was played
  const all = gamesInRange.flatMap((g) => {
    const day = dayKey(g.date);
    return g.problems.map((p) => ({ ...p, day })); // {...p} copies p, like python's {**p}
  });
  const ofType = view.type === "all" ? all : all.filter((p) => p.op === view.type);
  const solved = ofType.filter((p) => !p.skipped);

  renderTypeCards(ofType, solved);
  renderTypeTrend(solved);

  // which panels make sense for this type
  const gridTypes = ["all", "mul", "div"];
  $("ops-panel").classList.toggle("off", view.type !== "all");
  $("tt-panel").classList.toggle("off", !gridTypes.includes(view.type));
  $("breakdown-panel").classList.toggle("off", !BREAKDOWNS[view.type]);

  if (view.type === "all") renderOps(solved);
  if (gridTypes.includes(view.type)) renderTimesTable(solved);
  if (BREAKDOWNS[view.type]) renderBreakdown(solved);
  renderSlowest(solved);
}

function renderTypeCards(ofType, solved) {
  if (!ofType.length) {
    $("type-cards").innerHTML = emptyNote("none of these in this range yet");
    return;
  }
  const secs = solved.map((p) => p.ms / 1000);
  const skipped = ofType.length - solved.length;
  $("type-cards").innerHTML =
    card("average", secs.length ? `${mean(secs).toFixed(2)}s` : "–") +
    card("fastest", secs.length ? `${Math.min(...secs).toFixed(2)}s` : "–") +
    card("answered", solved.length) +
    card("skipped", skipped ? `${skipped} · ${((skipped / ofType.length) * 100).toFixed(0)}%` : "0");
}

function renderTypeTrend(solved) {
  const byDay = groupBy(solved, (p) => p.day);
  const points = Object.keys(byDay).sort().map((day) => ({ day, y: mean(byDay[day].map((p) => p.ms)) / 1000 }));
  $("type-trend").innerHTML = points.length
    ? lineChart(points, (v) => `${v.toFixed(1)}s`)
    : emptyNote("no answers in this range yet");
}

// bar list, one bar per bucket, coloured by speed
function barRows(rows) {
  const max = Math.max(...rows.map((r) => r.sec));
  return rows
    .map((r) => `
      <div class="op-row">
        <span class="op-name">${r.label}</span>
        <div class="op-track"><div class="op-bar" style="width:${((r.sec / max) * 100).toFixed(1)}%;background:${speedColor(r.sec)}"></div></div>
        <span class="op-sec">${r.sec.toFixed(1)}s</span>
      </div>`)
    .join("");
}

function renderBreakdown(solved) {
  if (!solved.length) {
    $("breakdown").innerHTML = emptyNote("no answers in this range yet");
    return;
  }

  $("breakdown").innerHTML = BREAKDOWNS[view.type]
    .map(({ title, bucket }) => {
      const groups = {};
      for (const p of solved) {
        const [order, label] = bucket(p);
        (groups[label] ||= { order, label, secs: [] }).secs.push(p.ms / 1000);
      }
      const rows = Object.values(groups)
        .sort((a, b) => a.order - b.order)
        .map((g) => ({ label: g.label, sec: mean(g.secs) }));
      return `<p class="muted">${title}</p>${barRows(rows)}`;
    })
    .join("");
}

function renderOps(problems) {
  const byOp = groupBy(problems, (p) => p.op);
  const rows = Object.keys(OP_LABELS)
    .filter((op) => byOp[op])
    .map((op) => ({ label: OP_LABELS[op], sec: mean(byOp[op].map((p) => p.ms)) / 1000 }));

  $("ops").innerHTML = rows.length ? barRows(rows) : emptyNote("no problems in this range yet");
}

// rows: the small number (2–25). columns: the big number in tens.
// division counts as its multiplication: 731 ÷ 17 = 43 goes in row 17, column 40s.
const TT_COLS = ["2", "10", "20", "30", "40", "50", "60", "70", "80", "90"];

function renderTimesTable(problems) {
  const cells = {}; // "17-4" → list of seconds
  for (const p of problems) {
    let small, big;
    if (p.op === "mul") { small = Math.min(p.a, p.b); big = Math.max(p.a, p.b); }
    else if (p.op === "div") { small = p.b; big = p.a / p.b; }
    else continue;
    if (small < 2 || small > 25) continue;
    const col = big < 10 ? 0 : Math.min(9, Math.floor(big / 10));
    (cells[`${small}-${col}`] ||= []).push(p.ms / 1000);
  }

  if (!Object.keys(cells).length) {
    $("times-table").innerHTML = emptyNote("no × or ÷ problems in this range yet");
    $("tt-caption").textContent = "";
    return;
  }

  let html = `<div class="tt-label"></div>` + TT_COLS.map((c) => `<div class="tt-label">${c}</div>`).join("");
  for (let small = 2; small <= 25; small++) {
    html += `<div class="tt-label">${small}</div>`;
    for (let col = 0; col < 10; col++) {
      const secs = cells[`${small}-${col}`];
      const range = col === 0 ? "2–9" : col === 9 ? "90–100" : `${col * 10}–${col * 10 + 9}`;
      if (!secs) {
        html += `<div class="tt-cell" data-info="${small} × ${range} · not seen yet"></div>`;
      } else {
        const avg = mean(secs);
        html += `<div class="tt-cell" style="background:${speedColor(avg)}" data-info="${small} × ${range} · ${avg.toFixed(1)}s avg · ${secs.length} seen"></div>`;
      }
    }
  }
  $("times-table").innerHTML = html;
  $("tt-caption").textContent = "tap a square";
}

function renderSlowest(problems) {
  const slow = [...problems].sort((a, b) => b.ms - a.ms).slice(0, 6);
  $("slowest").innerHTML = slow.length
    ? slow.map((p) => {
        const sec = p.ms / 1000;
        return `<div class="slow-row"><span>${p.text}</span><span style="color:${speedColor(sec)}">${sec.toFixed(1)}s</span></div>`;
      }).join("")
    : emptyNote("no problems in this range yet");
}

// ---------- controls ----------

$("range-tabs").addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  view.range = btn.dataset.range;
  renderStats();
});

$("from-date").addEventListener("change", (e) => { view.from = e.target.value; renderStats(); });
$("to-date").addEventListener("change", (e) => { view.to = e.target.value; renderStats(); });
$("preset-select").addEventListener("change", (e) => { view.preset = e.target.value; renderStats(); });
$("heat-select").addEventListener("change", (e) => { view.heat = e.target.value; renderHeatmap(); });
$("type-select").addEventListener("change", (e) => { view.type = e.target.value; renderStats(); });

// tapping a square shows its details in the caption underneath
function showInfoOnTap(gridId, captionId) {
  $(gridId).addEventListener("pointerdown", (e) => {
    const info = e.target.dataset.info;
    if (info) $(captionId).textContent = info;
  });
}
showInfoOnTap("heatmap", "heat-caption");
showInfoOnTap("times-table", "tt-caption");
