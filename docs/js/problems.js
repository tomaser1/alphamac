// problems.js: makes random problems and checks answers.
// every problem is an object (like a python dict):
//   { op: "mul", a: 17, b: 43, text: "17 × 43", kind: "exact", answer: 731 }
//
// kind says how answers are checked:
//   "exact"    the typed number must equal answer
//   "approx"   within ±0.1 of answer (square roots)
//   "fraction" answer is { num, den }; any equivalent fraction counts

// like python's random.randint(min, max): both ends included
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// like python's random.choice(list)
function choice(list) {
  return list[randInt(0, list.length - 1)];
}

// shows a number with a proper minus sign, and brackets if it's negative
// and not the first number: 12 + (−5)
function fmt(n, bracket = false) {
  if (n >= 0) return `${n}`;            // `${...}` is javascript's f-string
  return bracket ? `(−${-n})` : `−${-n}`;
}

// 20% of the time, flip a number to negative
function maybeNegative(n) {
  return Math.random() < 0.2 ? -n : n;
}

// removes float noise: 0.1 + 0.2 is 0.30000000000000004 in js (and python)
function clean(n) {
  return Number(n.toFixed(6));
}

// ---------- the four basics ----------

function addition() {
  const a = maybeNegative(randInt(2, 200));
  const b = maybeNegative(randInt(2, 200));
  return { op: "add", a, b, text: `${fmt(a)} + ${fmt(b, true)}`, kind: "exact", answer: a + b };
}

function subtraction() {
  // a − b can go negative on its own, so no extra negatives here
  const a = randInt(2, 200);
  const b = randInt(2, 200);
  return { op: "sub", a, b, text: `${a} − ${b}`, kind: "exact", answer: a - b };
}

function multiplication() {
  const small = randInt(2, 25);
  const big = randInt(2, 100);
  // randomise which side the small number is on
  const [a, b] = Math.random() < 0.5 ? [small, big] : [big, small];
  return { op: "mul", a, b, text: `${a} × ${b}`, kind: "exact", answer: a * b };
}

function division() {
  // built backwards from a multiplication, so it always divides exactly
  const divisor = randInt(2, 25);
  const answer = randInt(2, 100);
  const a = divisor * answer;
  return { op: "div", a, b: divisor, text: `${a} ÷ ${divisor}`, kind: "exact", answer };
}

// ---------- the extras ----------

function fractions() {
  // a/b ± c/d, each fraction between 0 and 1
  const b = randInt(2, 12);
  const d = randInt(2, 12);
  const a = randInt(1, b - 1);
  const c = randInt(1, d - 1);
  const plus = Math.random() < 0.5;
  const num = plus ? a * d + c * b : a * d - c * b;
  if (num === 0) return fractions(); // 3/4 − 3/4 is too easy, roll again
  return {
    op: "frac", a: `${a}/${b}`, b: `${c}/${d}`,
    text: `${a}/${b} ${plus ? "+" : "−"} ${c}/${d}`,
    kind: "fraction", answer: { num, den: b * d },
  };
}

function squareRoot() {
  // skip perfect squares; this is an estimation drill
  let n;
  do {
    n = randInt(2, 500);
  } while (Number.isInteger(Math.sqrt(n)));
  return { op: "sqrt", a: n, text: `√${n}`, kind: "approx", answer: Math.sqrt(n) };
}

function percentage() {
  // picked so the answer is always a whole number
  const p = randInt(1, 19) * 5;   // 5%, 10% … 95%
  const n = randInt(1, 20) * 20;  // 20, 40 … 400
  return { op: "pct", a: p, b: n, text: `${p}% of ${n}`, kind: "exact", answer: (p * n) / 100 };
}

function decimals() {
  if (Math.random() < 0.5) {
    const a = randInt(11, 99) / 10;  // 1.1 – 9.9
    const b = randInt(2, 9) / 10;    // 0.2 – 0.9
    return { op: "dec", a, b, text: `${a} × ${b}`, kind: "exact", answer: clean(a * b) };
  }
  const a = randInt(101, 999) / 10;  // 10.1 – 99.9
  const b = randInt(101, 999) / 100; // 1.01 – 9.99
  return { op: "dec", a, b, text: `${a} + ${b}`, kind: "exact", answer: clean(a + b) };
}

function squares() {
  const n = randInt(11, 40);
  return { op: "sq", a: n, text: `${n}²`, kind: "exact", answer: n * n };
}

// ---------- the mixes ----------

const MIXES = {
  classic: [addition, subtraction, multiplication, division],
  quant: [addition, subtraction, multiplication, division,
          fractions, squareRoot, percentage, decimals, squares],
};

function makeProblem(mix = "classic") {
  const generator = choice(MIXES[mix]);
  return generator();
}

// ---------- checking ----------

// typed is the string from the keypad, like "-12", "4.1" or "3/4"
function isCorrect(typed, problem) {
  if (problem.kind === "fraction") return fractionMatches(typed, problem.answer);

  if (typed === "" || typed.includes("/")) return false;
  const x = Number(typed);              // Number("-") and Number("1.2.3") give NaN
  if (Number.isNaN(x)) return false;

  const tolerance = problem.kind === "approx" ? 0.1 + 1e-9 : 1e-9;
  return Math.abs(x - problem.answer) <= tolerance;
}

// 6/8 matches 3/4 because 6 × 4 === 3 × 8 (cross-multiplying)
function fractionMatches(typed, { num, den }) {
  const parts = typed.split("/");
  if (parts.length > 2) return false;
  if (parts.some((p) => p === "" || p === "-" || p.includes("."))) return false;

  const p = Number(parts[0]);
  const q = parts.length === 2 ? Number(parts[1]) : 1; // "1" means 1/1
  if (q === 0) return false;
  return p * den === num * q;
}
