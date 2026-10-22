"""Simulates a few months of alphamac games and writes them as a backup file.

Import the file with the "import" button on the home screen to see the stats
screen full of data. Only import it into a test copy of the app (e.g. on your
PC), not the one on your phone, or it'll mix with your real games.

    python tools/make_fake_data.py              # ~100 days
    python tools/make_fake_data.py --days 200   # longer history
"""

import argparse
import json
import math
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

# same presets as MODES in app.js: (mode, value, mix)
PRESETS = [
    ("timed", 150, "classic"),
    ("timed", 300, "classic"),
    ("timed", 500, "classic"),
    ("sprint", 20, "classic"),
    ("sprint", 50, "classic"),
    ("sprint", 100, "classic"),
    ("quant", 480, "quant"),
]
# quant gets picked most, since that's the one you said you'd play most
PRESET_WEIGHTS = [3, 2, 1, 2, 1, 0.5, 5]


# ---------- problem generators (same rules as problems.js) ----------

def show(n, bracket=False):
    if n >= 0:
        return str(n)
    return f"(−{-n})" if bracket else f"−{-n}"


def maybe_negative(n):
    return -n if random.random() < 0.2 else n


def addition():
    a = maybe_negative(random.randint(2, 200))
    b = maybe_negative(random.randint(2, 200))
    return {"op": "add", "a": a, "b": b, "text": f"{show(a)} + {show(b, True)}"}


def subtraction():
    a, b = random.randint(2, 200), random.randint(2, 200)
    return {"op": "sub", "a": a, "b": b, "text": f"{a} − {b}"}


def multiplication():
    small, big = random.randint(2, 25), random.randint(2, 100)
    a, b = (small, big) if random.random() < 0.5 else (big, small)
    return {"op": "mul", "a": a, "b": b, "text": f"{a} × {b}"}


def division():
    divisor, answer = random.randint(2, 25), random.randint(2, 100)
    a = divisor * answer
    return {"op": "div", "a": a, "b": divisor, "text": f"{a} ÷ {divisor}"}


def fractions():
    b, d = random.randint(2, 12), random.randint(2, 12)
    a, c = random.randint(1, b - 1), random.randint(1, d - 1)
    plus = random.random() < 0.5
    if not plus and a * d == c * b:
        return fractions()
    return {"op": "frac", "a": f"{a}/{b}", "b": f"{c}/{d}",
            "text": f"{a}/{b} {'+' if plus else '−'} {c}/{d}"}


def square_root():
    while True:
        n = random.randint(2, 500)
        if math.isqrt(n) ** 2 != n:
            return {"op": "sqrt", "a": n, "text": f"√{n}"}


def percentage():
    p, n = random.randint(1, 19) * 5, random.randint(1, 20) * 20
    return {"op": "pct", "a": p, "b": n, "text": f"{p}% of {n}"}


def decimals():
    if random.random() < 0.5:
        a, b = random.randint(11, 99) / 10, random.randint(2, 9) / 10
        return {"op": "dec", "a": a, "b": b, "text": f"{a:g} × {b:g}"}
    a, b = random.randint(101, 999) / 10, random.randint(101, 999) / 100
    return {"op": "dec", "a": a, "b": b, "text": f"{a:g} + {b:g}"}


def squares():
    n = random.randint(11, 40)
    return {"op": "sq", "a": n, "text": f"{n}²"}


MIXES = {
    "classic": [addition, subtraction, multiplication, division],
    "quant": [addition, subtraction, multiplication, division,
              fractions, square_root, percentage, decimals, squares],
}


# ---------- how long a simulated you takes ----------

BASE_SECONDS = {"add": 2.0, "sub": 2.3, "mul": 2.6, "div": 3.0, "frac": 6.5,
                "sqrt": 4.5, "pct": 3.2, "dec": 4.2, "sq": 3.0}


def seconds_for(problem, progress):
    """progress goes 0 → 1 over the simulated months; you get faster."""
    sec = BASE_SECONDS[problem["op"]]

    # bigger numbers are harder
    if problem["op"] in ("mul", "div"):
        if problem["op"] == "mul":
            small = min(problem["a"], problem["b"])
            big = max(problem["a"], problem["b"])
        else:
            small, big = problem["b"], problem["a"] // problem["b"]
        if small > 12:
            sec += 0.12 * (small - 12)   # 13–25 times tables are slower...
        if small in (13, 17, 19, 23):
            sec += 0.8                   # ...and a few are your nemesis
        sec += 0.012 * big
    elif problem["op"] in ("add", "sub"):
        if min(problem["a"], problem["b"]) < 0:
            sec += 0.6                   # negatives slow you down a bit
        sec += 0.004 * (abs(problem["a"]) + abs(problem["b"]))
    elif problem["op"] == "sq":
        sec += 0.06 * (problem["a"] - 11)

    improvement = 1.4 - 0.6 * math.sqrt(progress)  # fast gains early, slower later
    noise = random.lognormvariate(0, 0.3)          # some problems just click, some don't
    return max(0.6, sec * improvement * noise)


# ---------- games ----------

def play(mode, value, mix, ended_at, progress):
    problems, total_ms = [], 0
    limit_ms = value * 1000

    while True:
        problem = random.choice(MIXES[mix])()
        ms = round(seconds_for(problem, progress) * 1000)
        if mode != "sprint" and total_ms + ms > limit_ms:
            break  # time ran out mid-problem, like the real game
        total_ms += ms
        problems.append({**problem, "ms": ms, "skipped": False})
        if mode == "sprint" and len(problems) == value:
            break

    return {
        "date": ended_at.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "mode": mode,
        "value": value,
        "mix": mix,
        "score": len(problems),
        "skips": 0,
        "timeMs": total_ms if mode == "sprint" else limit_ms,
        "problems": problems,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=100)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--out", default=str(Path(__file__).parent / "alphamac-fake-backup.json"))
    args = parser.parse_args()

    random.seed(args.seed)  # same seed → same fake history every run
    now = datetime.now().astimezone()
    games = []

    for days_ago in range(args.days, -1, -1):
        # the odd day off, but the last two weeks are unbroken so there's a streak
        if days_ago > 14 and random.random() < 0.08:
            continue

        day = (now - timedelta(days=days_ago)).replace(hour=0, minute=0, second=0, microsecond=0)
        progress = 1 - days_ago / args.days
        for _ in range(random.choice([2, 3])):
            ended_at = day + timedelta(minutes=random.randint(7 * 60, 23 * 60))
            if ended_at > now:
                ended_at = now - timedelta(minutes=random.randint(5, 120))
            mode, value, mix = random.choices(PRESETS, weights=PRESET_WEIGHTS)[0]
            games.append(play(mode, value, mix, ended_at, progress))

    games.sort(key=lambda g: g["date"])
    backup = {"app": "alphamac", "version": 1, "exportedAt": now.isoformat(), "games": games}
    Path(args.out).write_text(json.dumps(backup), encoding="utf-8")

    problems = sum(len(g["problems"]) for g in games)
    print(f"wrote {len(games)} games, {problems} problems to {args.out}")


if __name__ == "__main__":
    main()
