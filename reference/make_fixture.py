"""Deterministic synthetic fixtures for the addon golden tests (no real data).

Usage: python3 -I make_fixture.py main > synthetic.json
       python3 -I make_fixture.py edge > synthetic-edge.json
       python3 -I make_fixture.py window > synthetic-window.json
       python3 -I make_fixture.py short > synthetic-short.json
       python3 -I make_fixture.py mix > synthetic-mix.json
"""

import datetime as dt
import json
import math
import sys


def days(start, end, weekdays_only):
    d = start
    while d <= end:
        if not weekdays_only or d.weekday() < 5:
            yield d
        d += dt.timedelta(days=1)


def path(start, end, p0, drift, amp, period, weekdays_only):
    out = []
    for d in days(start, end, weekdays_only):
        t = (d - start).days / 365.25
        out.append(
            [
                d.isoformat(),
                p0 * math.exp(drift * t) * (1 + amp * math.sin(2 * math.pi * t / period)),
            ]
        )
    return out


def with_daily(fx):
    """Adds the real portfolio's daily valuation (every calendar day from the window start to the day
    before `today`): money in the portfolio times a growth curve with swings, joined continuously to the
    opening value and to `actual.value`, so the time-weighted index has a recovered and an open drawdown."""
    today = dt.date.fromisoformat(fx["today"])
    start = fx.get("start")
    lo = start["date"] if start else None
    raw = sorted((f for f in fx["flows"] if f["date"] <= fx["today"] and (lo is None or f["date"] > lo)),
                 key=lambda f: f["date"])
    first = dt.date.fromisoformat(lo) if start else dt.date.fromisoformat(raw[0]["date"])
    base0 = start["value"] if start else 0.0

    def money(d):
        return base0 + sum(f["amount"] for f in raw if f["date"] <= d.isoformat())

    span = (today - first).days / 365.25
    swing = lambda t: 0.07 * math.sin(2 * math.pi * t / 1.7)
    drift = (fx["actual"]["value"] / money(today) - 1 - swing(span)) / span
    daily = []
    for d in days(first, today - dt.timedelta(days=1), False):
        t = (d - first).days / 365.25
        daily.append([d.isoformat(), round(money(d) * (1 + drift * t + swing(t)), 2)])
    fx["actual"]["daily"] = daily
    return fx


def cpi_table(first_year, today, missing_last, gaps=()):
    out = {}
    months = (today.year - first_year) * 12 + today.month - missing_last
    for i in range(months):
        y, m = first_year + i // 12, i % 12 + 1
        if f"{y}-{m:02d}" in gaps:
            continue
        out[f"{y}-{m:02d}"] = round(
            100 * math.exp(0.025 * i / 12 + (0.04 * max(0, i - 36) / 12 if i < 60 else 0.04 * 2)), 3
        )
    return out


def base():
    start, today = dt.date(2019, 1, 2), dt.date(2026, 6, 15)
    flows = []
    for y in range(2019, 2026):
        for m in range(1, 13):
            flows.append({"date": dt.date(y, m, 3 if m % 2 else 6).isoformat(), "amount": 500.0})
    flows += [
        {"date": "2019-01-04", "amount": 60000.0},
        {"date": "2020-02-29", "amount": 3000.0},
        {"date": "2020-06-10", "amount": -4000.0},  # before the late starter's first price
        {"date": "2021-03-01", "amount": -2500.0},
        {"date": "2023-07-15", "amount": -26000.0},  # Saturday; exceeds the total-loss variant
        {"date": "2024-08-08", "amount": 1000.0},  # same day, nets to zero
        {"date": "2024-08-08", "amount": -1000.0},
        {"date": "2024-09-09", "amount": -100.0},  # same day, nets to +200
        {"date": "2024-09-09", "amount": 300.0},
        {"date": "2025-12-20", "amount": 4000.0},
        {"date": "2026-02-10", "amount": -1500.0},
    ]
    variants = [
        {
            "name": "Rising",
            "kind": "asset",
            "points": path(start, today, 50, 0.09, 0.15, 2.7, True),
        },
        {
            "name": "Falling",
            "kind": "asset",
            "points": path(start, today, 80, -0.06, 0.10, 3.1, True),
        },
        {
            "name": "Volatile crypto",
            "kind": "asset",
            "points": path(start, today, 3000, 0.35, 0.45, 1.9, False),
        },
        {
            "name": "Late start",
            "kind": "asset",
            "points": path(dt.date(2021, 1, 4), today, 10, 0.2, 0.3, 2.0, False),
        },
        {
            "name": "Total loss",
            "kind": "asset",
            "points": path(start, today, 100, -1.2, 0.0, 1.0, False),
        },
        {
            "name": "Stale",
            "kind": "asset",
            "points": path(start, dt.date(2026, 5, 20), 40, 0.1, 0.05, 4.0, True),
        },
        {
            "name": "Gap",
            "kind": "asset",
            "points": [
                p
                for p in path(start, today, 40, 0.1, 0.05, 4.0, True)
                if not ("2022-03-01" <= p[0] <= "2022-04-30")
            ],
        },
        {"name": "Cash", "kind": "cash", "points": []},
    ]
    return {
        "today": today.isoformat(),
        "flows": flows,
        "variants": variants,
        # last month missing on purpose; 2025-10/11 missing inside the series (flows in both)
        "cpi": cpi_table(2019, today, 1, gaps=("2025-10", "2025-11")),
        "actual": {"value": 101234.56},
    }


def main():
    return with_daily(base())


def edge():
    """Small cases: shortfall before the first price, cash shortfall, flows only before the
    first price, a deposit on today's Saturday after Friday's last price, no CPI."""
    today = dt.date(2024, 6, 29)
    flows = [
        {"date": "2024-01-02", "amount": 1000.0},
        {"date": "2024-01-20", "amount": -1500.0},  # more than the cash collected before start
        {"date": "2024-02-01", "amount": 2000.0},
        {"date": "2024-02-01", "amount": -500.0},
        {"date": "2024-03-04", "amount": -5000.0},  # exceeds every variant
        {"date": "2024-06-29", "amount": 700.0},  # Saturday = today: weekday series use Friday
    ]
    return {
        "today": today.isoformat(),
        "flows": flows,
        "variants": [
            {
                "name": "Start March",
                "kind": "asset",
                "points": path(dt.date(2024, 3, 1), today, 20, 0.3, 0.1, 0.5, True),
            },
            {
                "name": "Start June",
                "kind": "asset",
                "points": path(dt.date(2024, 6, 3), today, 5, 0.0, 0.0, 1.0, True),
            },
            {
                "name": "Continuous",
                "kind": "asset",
                "points": path(dt.date(2023, 12, 1), today, 10, 0.1, 0.2, 0.7, False),
            },
            {"name": "After today", "kind": "asset", "points": [["2024-07-01", 1.0]]},
            {"name": "Empty", "kind": "asset", "points": []},
            {"name": "Cash", "kind": "cash", "points": []},
        ],
        "cpi": None,
        "actual": {"value": 0.0},
    }


def window():
    """The main fixture over a window: opening value on a Wednesday mid-way, a custom end before
    the end of every price series and inside the CPI series, a series starting inside the window."""
    fx = base()
    end = dt.date(2025, 12, 31)
    fx["today"] = end.isoformat()
    fx["start"] = {"date": "2023-03-15", "value": 83456.78}
    fx["actual"] = {"value": 97000.0}
    fx["variants"].append(
        {
            "name": "Starts in window",
            "kind": "asset",
            "points": path(dt.date(2024, 1, 8), dt.date(2026, 6, 15), 30, 0.15, 0.2, 1.5, True),
        }
    )
    return with_daily(fx)


def short():
    """A one-month window opening on a Sunday: weekday series buy at Friday's close, the money-weighted
    return is over the window (not annualised); a withdrawal right after the start."""
    fx = base()
    fx["today"] = "2025-06-30"
    fx["start"] = {"date": "2025-06-01", "value": 91000.0}
    fx["actual"] = {"value": 92500.0}
    fx["flows"].append({"date": "2025-06-02", "amount": -3000.0})
    return with_daily(fx)


def mix():
    """Fixed mixes over the main flows plus a deposit on New Year's Day and a withdrawal on the next:
    yearly and never rebalanced, a component starting late (daily series), a mix that cannot cover a
    withdrawal, two identical components (must equal the single asset) and a component with a gap."""
    fx = base()
    start, today = dt.date(2019, 1, 2), dt.date(2026, 6, 15)
    fx["flows"] += [{"date": "2024-01-01", "amount": 1000.0}, {"date": "2025-01-01", "amount": -500.0}]
    stocks = path(start, today, 50, 0.09, 0.15, 2.7, True)
    bonds = path(start, today, 100, 0.02, 0.04, 1.3, True)
    crypto = path(dt.date(2021, 1, 4), today, 10, 0.2, 0.3, 2.0, False)
    crash = path(start, today, 100, -1.2, 0.0, 1.0, False)
    gap = [p for p in bonds if not ("2022-03-01" <= p[0] <= "2022-04-30")]
    fx["variants"] = [
        {"name": "Stocks", "kind": "asset", "points": stocks},
        {"name": "70/30 yearly", "kind": "mix", "rebalance": "yearly",
         "components": [{"weight": 70, "points": stocks}, {"weight": 30, "points": bonds}]},
        {"name": "70/30 never", "kind": "mix", "rebalance": "none",
         "components": [{"weight": 70, "points": stocks}, {"weight": 30, "points": bonds}]},
        {"name": "With late crypto", "kind": "mix", "rebalance": "yearly",
         "components": [{"weight": 60, "points": stocks}, {"weight": 25, "points": bonds},
                        {"weight": 15, "points": crypto}]},
        {"name": "Crash mix", "kind": "mix", "rebalance": "yearly",
         "components": [{"weight": 50, "points": crash}, {"weight": 50, "points": crash}]},
        {"name": "Stocks twice", "kind": "mix", "rebalance": "yearly",
         "components": [{"weight": 40, "points": stocks}, {"weight": 60, "points": stocks}]},
        {"name": "Gap mix", "kind": "mix", "rebalance": "yearly",
         "components": [{"weight": 50, "points": stocks}, {"weight": 50, "points": gap}]},
    ]
    fx["cpi"] = cpi_table(2019, today, 1)
    return fx


if __name__ == "__main__":
    print(json.dumps({"main": main, "edge": edge, "window": window, "short": short, "mix": mix}[sys.argv[1]]()))
