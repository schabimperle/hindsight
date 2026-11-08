"""Reference model (oracle) for the 'Hindsight' Wealthfolio addon.

Single-asset counterfactuals vs. the real portfolio, before taxes and fees, nominal and in
today's purchasing power (CPI of one country), with XIRR. The TypeScript core must reproduce
this model.

Input: JSON fixture on argv[1]; output: JSON results on stdout.
Fixture (all amounts in the base currency):
  {"today": "YYYY-MM-DD",
   "flows": [{"date": "YYYY-MM-DD", "amount": float}],    # + into the portfolio, - out of it
   "variants": [{"name": str, "kind": "asset"|"cash",
                 "points": [["YYYY-MM-DD", price], ...]}    # prices already in base currency
                | {"name": str, "kind": "mix", "rebalance": "yearly"|"none",
                   "components": [{"weight": float, "points": [...]}, ...]}],
   "cpi": {"YYYY-MM": float} | null,                        # null: no real figures; gaps allowed
   "actual": {"value": float,                               # optional: the real portfolio
              "daily": [["YYYY-MM-DD", float], ...]},       # optional: its valuation on fully covered days
   "start": {"date": "YYYY-MM-DD", "value": float}}         # optional: window start (see below)

Model decisions (documented in the addon UI):
- Flows are netted per day first; a day that nets to zero has no flow.
- A deposit buys units at the price of its day or the next trading day (at most
  MAX_PRICE_GAP_DAYS later); a withdrawal sells units worth the amount. Without any later
  price (a flow on today's weekend, or today before the close) the last price on or before
  the flow day stands in, if it is at most MAX_PRICE_GAP_DAYS old.
- Before the first price of a series the money waits as cash (withdrawals reduce it); on the
  first price day all of it is bought at once (`uninvestedUntil`).
- A withdrawal larger than the variant's value sells everything; only the covered part counts
  as executed flow (`shortfall`, `shortfalls`). Gain and XIRR use the executed flows.
- The real portfolio uses its value from Wealthfolio and all flows.
- Window: `today` is the window end (flows and prices after it do not count). With `start`, the
  real portfolio's value at the end of the start day is an opening deposit on that day and every
  flow up to and including that day is dropped (it is inside that value). Every alternative buys
  with the opening amount at the last price on or before the start day (at most
  MAX_PRICE_GAP_DAYS old; the real value is a close of that day or before it, e.g. Friday's for a
  Saturday), else like any deposit. Without `start` the window begins with the first flow.
- Money-weighted return (XIRR): per year (365.25 days) if the window spans at least 365 days, else
  over the window itself (`mwrPeriodDays` = its length in days), as Wealthfolio's Performance page
  does; annualising a week would turn small moves into absurd rates.
- Real figures convert every executed flow with the CPI of the flow's month to the purchasing
  power of `today`'s month (the last published month stands in for later months, the previous published
  month for a month missing inside the series; `cpiFilled` lists such months used by a flow).
  A flow before the first CPI month: no real figures (`cpiError`).
- Mix (fixed weights): weights are normalised to sum 1. Events are processed in date order;
  on one day first component starts, then a rebalance, then the flows:
  - a deposit is split by the weights; a started component buys at its price for the day (the
    single-asset rules: opening price on the opening day, else trade price), a component before
    its first price keeps its share as cash (`uninvestedUntil`: latest such first price);
  - a withdrawal sells every component pro rata to its value at those prices (cash at face value);
    if it exceeds the total, everything is sold and the rest is a shortfall, as for one asset;
  - a component whose first price comes after the first flow starts on that day: its cash buys at
    its first price;
  - "yearly": for every year after the first flow's, on the first day on which every component
    started before Jan 1 has a price on or after Jan 1 (each at most MAX_PRICE_GAP_DAYS after it,
    else prices_missing; not yet happened if that day is after `today`), all components are
    valued at their last price on or before that day and reset to the weights (not started ones
    as cash). "none": never.
  - Value: units at each component's last price, plus cash; a component whose prices start after
    `today` makes the mix uncomputable (no_prices), as does any price error of a component.
- Maximum drawdown (`drawdown`, nominal) is measured on a time-weighted index, so deposits and
  withdrawals are neither gains nor losses:
  - An asset alternative's index is its price relative to the price the simulation first invests
    at (the opening price rule in a window, the trade price of the first deposit, or the first
    price after a late start), over every later price point up to `today`, starting on the day of
    that investment: a single asset's time-weighted return is its price return, whatever the
    simulated position holds.
  - Cash ("Not invested") never falls: max 0.
  - A mix's index is the strategy's: one unit deposited on the first deposit day (opening rule in a
    window) and run with the same rebalancing, valued on every price day of any component from the
    day all components bought (or on the entry day itself, level 1) up to `today`. It is the
    strategy's risk, not the simulated position's (deposits at target weights shift a drifted
    position slightly).
  - The real portfolio's index chains daily steps over `actual.daily` (only days on which every
    started account has its own valuation) between the window start (the opening value, or the
    first flow day) and `today` (`actual.value`; the caller only passes `daily` when both ends are
    fully covered as well), with Wealthfolio's convention: deposits at the
    start of the day, withdrawals at its end, both from the original bookings (not netted):
    r = (V_t + out_t - V_prev - in_t) / (V_prev + in_t). Before the chain starts, steps from a
    non-positive value are skipped; a base below MIN_RETURN_BASE pauses the index; a negative
    value or base after the start makes the drawdown unavailable (null), as does a booking on a
    day without a valuation point or a missing daily series.
  - On the index: running peak (a value at or above it, within a relative 1e-12, is a new peak),
    drawdown = index / peak - 1; `max` is the lowest drawdown, `peak` the date of the peak before
    it, `trough` the date of the lowest point. Without any drawdown below -1e-12: max 0, all dates null.
"""

import bisect
import datetime as dt
import json
import sys

D = dt.date.fromisoformat
MAX_PRICE_GAP_DAYS = 10  # holidays plus the odd missing quote
EPS = 1e-9
MIN_RETURN_BASE = 1.0  # Wealthfolio's: a smaller day base pauses the time-weighted index
PEAK_TOL = 1e-12
NO_DRAWDOWN = {"max": 0.0, "peak": None, "trough": None}


class PriceError(Exception):
    pass


class Series:
    def __init__(self, points):
        pts = sorted((D(d), float(p)) for d, p in points if p is not None)
        if not pts:
            raise PriceError("no_prices")
        self.d = [p[0] for p in pts]
        self.p = [p[1] for p in pts]

    def trade_price(self, day):
        """First price on or after `day`, at most MAX_PRICE_GAP_DAYS later. Without any later
        price, the last one on or before `day` if at most MAX_PRICE_GAP_DAYS old.

        Else PriceError."""
        i = bisect.bisect_left(self.d, day)
        if i >= len(self.d):
            if (day - self.d[-1]).days <= MAX_PRICE_GAP_DAYS:
                return self.p[-1]
            raise PriceError("prices_missing")
        if (self.d[i] - day).days > MAX_PRICE_GAP_DAYS:
            raise PriceError("prices_missing")
        return self.p[i]

    def opening_price(self, day):
        """Last price on or before `day` if at most MAX_PRICE_GAP_DAYS old, else None."""
        i = bisect.bisect_right(self.d, day) - 1
        if i < 0 or (day - self.d[i]).days > MAX_PRICE_GAP_DAYS:
            return None
        return self.p[i]

    def last(self, today):
        """Last price on or before `today`, at most MAX_PRICE_GAP_DAYS old."""
        i = bisect.bisect_right(self.d, today) - 1
        if i < 0 or (today - self.d[i]).days > MAX_PRICE_GAP_DAYS:
            raise PriceError("prices_stale")
        return self.p[i]


def window_flows(flows, today, start):
    """Flows inside the window (start, today], plus the opening deposit on the start day."""
    lo = start["date"] if start else None
    out = [f for f in flows if f["date"] <= today.isoformat() and (lo is None or f["date"] > lo)]
    if start and start["value"] > EPS:
        out.append({"date": lo, "amount": start["value"]})
    return out


def net_flows(flows):
    """Sum per day, sorted by date; days that net to zero are dropped."""
    by_day = {}
    for f in flows:
        by_day[f["date"]] = by_day.get(f["date"], 0.0) + f["amount"]
    return [(D(d), a) for d, a in sorted(by_day.items()) if abs(a) > EPS]


def simulate(flows, variant, today, opening_day=None):
    """-> (value, executed flows [(day, amount)], shortfalls [(day, amount)], uninvested_until)."""
    executed, shortfalls = [], []
    cash = 0.0
    units = 0.0

    def withdraw_cash(day, amount):
        nonlocal cash
        take = min(-amount, cash)
        cash -= take
        if take > EPS:
            executed.append((day, -take))
        if -amount - take > EPS:
            shortfalls.append((day, -amount - take))

    if variant["kind"] == "cash":
        for day, a in flows:
            if a > 0:
                cash += a
                executed.append((day, a))
            else:
                withdraw_cash(day, a)
        return cash, executed, shortfalls, None

    series = Series(variant["points"])
    first = series.d[0]
    if first > today:
        raise PriceError("no_prices")
    started = False
    uninvested_until = None

    def start():
        nonlocal started, units, cash
        started = True
        units += cash / series.p[0]
        cash = 0.0

    for day, a in flows:
        if not started and day >= first:
            start()
        if not started:
            uninvested_until = first.isoformat()
            if a > 0:
                cash += a
                executed.append((day, a))
            else:
                withdraw_cash(day, a)
            continue
        p = series.opening_price(day) if day == opening_day else None
        if p is None:
            p = series.trade_price(day)
        if a > 0:
            units += a / p
            executed.append((day, a))
        elif -a / p <= units * (1 + 1e-12):
            units = max(0.0, units + a / p)
            executed.append((day, a))
        else:
            covered = units * p
            units = 0.0
            if covered > EPS:
                executed.append((day, -covered))
            shortfalls.append((day, -a - covered))
    if not started:
        start()
    return units * series.last(today), executed, shortfalls, uninvested_until


def entry_index(series, flows, opening_day):
    """(index of the price the simulation first invests at, day of that investment); see `simulate`.
    The first deposit counts: a withdrawal before it buys nothing."""
    day = next((d for d, a in flows if a > 0), series.d[0])
    if day < series.d[0]:
        return 0, series.d[0]
    if day == opening_day and series.opening_price(day) is not None:
        return bisect.bisect_right(series.d, day) - 1, day
    i = bisect.bisect_left(series.d, day)
    return min(i, len(series.d) - 1), max(day, series.d[min(i, len(series.d) - 1)])


def asset_index(variant, flows, today, opening_day):
    """The index starts on the day of the first investment (a weekend opening keeps Friday's price as base)."""
    series = Series(variant["points"])
    i, day = entry_index(series, flows, opening_day)
    base = series.p[i]
    return [(day, 1.0)] + [(series.d[j], series.p[j] / base) for j in range(i + 1, len(series.d)) if series.d[j] <= today]


def actual_index(fx, today):
    """Time-weighted index of the real portfolio, or None (see the model notes)."""
    actual = fx["actual"]
    if actual.get("daily") is None:
        return None
    start = fx.get("start")
    lo = start["date"] if start else None
    raw = [f for f in fx["flows"] if f["date"] <= today.isoformat() and (lo is None or f["date"] > lo)]
    if not raw and not start:
        return None
    first = D(lo) if start else min(D(f["date"]) for f in raw)
    daily = sorted((D(d), float(v)) for d, v in actual["daily"])
    points = [(first, float(start["value"]))] if start else []
    points += [(d, v) for d, v in daily if (first < d if start else first <= d) and d < today]
    points.append((today, float(actual["value"])))
    inflow, outflow = {}, {}
    for f in raw:
        book = inflow if f["amount"] > 0 else outflow
        book[D(f["date"])] = book.get(D(f["date"]), 0.0) + abs(f["amount"])
    covered = {d for d, _ in points}
    if any(d not in covered for d in list(inflow) + list(outflow)):
        return None
    index, factor, started = [], 1.0, False
    for (d0, v0), (d1, v1) in zip(points, points[1:]):
        fin, fout = inflow.get(d1, 0.0), outflow.get(d1, 0.0)
        if not started:
            if v0 <= 0:
                continue
            started = True
            index.append((d0, 1.0))
        if v0 < 0 or v1 < 0:
            return None
        base = v0 + fin
        if base < 0:
            return None
        if base >= MIN_RETURN_BASE:
            factor *= 1 + (v1 + fout - v0 - fin) / base
        index.append((d1, factor))
    return index if started else None


def drawdown(index):
    """Maximum drawdown on an index [(day, level)], see the model notes."""
    if not index:
        return None
    peak, peak_day = index[0][1], index[0][0]
    worst, at_peak, trough = 0.0, None, None
    for day, level in index:
        if level >= peak * (1 - PEAK_TOL):
            peak, peak_day = max(peak, level), day
            continue
        dd = level / peak - 1
        if dd < worst:
            worst, at_peak, trough = dd, peak_day, day
    if trough is None:
        return dict(NO_DRAWDOWN)
    return {"max": worst, "peak": at_peak.isoformat(), "trough": trough.isoformat()}


def mix_parts(variant):
    total = sum(float(c["weight"]) for c in variant["components"])
    return [(Series(c["points"]), float(c["weight"]) / total) for c in variant["components"]]


def mix_price(series, day, opening_day):
    """(price, price day) a mix component trades at on `day` (the single-asset rules)."""
    if day == opening_day and series.opening_price(day) is not None:
        return series.opening_price(day), day
    p = series.trade_price(day)
    i = bisect.bisect_left(series.d, day)
    return p, series.d[min(i, len(series.d) - 1)] if i < len(series.d) else day


def rebalance_days(parts, first_flow, today):
    out = []
    for y in range(first_flow.year + 1, today.year + 1):
        jan1 = dt.date(y, 1, 1)
        due = []
        for s, _ in parts:
            if s.d[0] >= jan1:
                continue
            k = bisect.bisect_left(s.d, jan1)
            if k < len(s.d) and (s.d[k] - jan1).days > MAX_PRICE_GAP_DAYS:
                raise PriceError("prices_missing")
            due.append(s.d[k] if k < len(s.d) else None)
        if not due:
            continue
        if None in due or max(due) > today:
            continue
        out.append(max(due))
    return out


def simulate_mix(flows, variant, today, opening_day=None):
    """-> (value, executed, shortfalls, uninvested_until, history [(day, cash[], units[])])."""
    parts = mix_parts(variant)
    n = len(parts)
    if any(s.d[0] > today for s, _ in parts):
        raise PriceError("no_prices")
    if not flows:
        return 0.0, [], [], None, []
    first_flow = flows[0][0]
    cash, units = [0.0] * n, [0.0] * n
    started = [s.d[0] <= first_flow for s, _ in parts]
    events = [(s.d[0], 0, i) for i, (s, _) in enumerate(parts) if s.d[0] > first_flow]
    if variant.get("rebalance") == "yearly":
        events += [(d, 1, None) for d in rebalance_days(parts, first_flow, today)]
    events += [(d, 2, a) for d, a in flows]
    events.sort(key=lambda e: (e[0], e[1]))
    executed, shortfalls, history = [], [], []
    uninvested_until = None
    for day, order, data in events:
        if order == 0:
            s = parts[data][0]
            units[data] += cash[data] / s.p[0]
            cash[data] = 0.0
            started[data] = True
        elif order == 1:
            prices = [parts[i][0].opening_price(day) if started[i] else None for i in range(n)]
            vals = [units[i] * prices[i] if started[i] else cash[i] for i in range(n)]
            total = sum(vals)
            if total > EPS:
                for i, (_, w) in enumerate(parts):
                    if started[i]:
                        units[i] = total * w / prices[i]
                    else:
                        cash[i] = total * w
        elif data > 0:
            executed.append((day, data))
            for i, (s, w) in enumerate(parts):
                if started[i]:
                    units[i] += data * w / mix_price(s, day, opening_day)[0]
                else:
                    cash[i] += data * w
                    first = s.d[0].isoformat()
                    uninvested_until = max(uninvested_until or first, first)
        else:
            vals = [units[i] * mix_price(s, day, opening_day)[0] if started[i] else cash[i]
                    for i, (s, _) in enumerate(parts)]
            total = sum(vals)
            if total > 0 and -data <= total * (1 + 1e-12):
                keep = max(0.0, 1 - (-data) / total)
                units = [u * keep for u in units]
                cash = [c * keep for c in cash]
                executed.append((day, data))
            else:
                units, cash = [0.0] * n, [0.0] * n
                if total > EPS:
                    executed.append((day, -total))
                shortfalls.append((day, -data - total))
        history.append((day, list(cash), list(units)))
    value = sum(units[i] * s.last(today) for i, (s, _) in enumerate(parts) if units[i] > 0) + sum(cash)
    return value, executed, shortfalls, uninvested_until, history


def mix_value_on(parts, history, day):
    """Value of the latest state on or before `day`; None if a held component has no price then."""
    state = None
    for h in history:
        if h[0] > day:
            break
        state = h
    if state is None:
        return 0.0
    _, cash, units = state
    total = sum(cash)
    for (s, _), u in zip(parts, units):
        if u > 1e-12:
            p = s.opening_price(day)
            if p is None:
                return None
            total += u * p
    return total


def mix_index(variant, flows, today, opening_day):
    parts = mix_parts(variant)
    entry = next((d for d, a in flows if a > 0), None)
    if entry is None:
        return None
    _, _, _, _, history = simulate_mix([(entry, 1.0)], variant, today, opening_day)
    bought = max((mix_price(s, entry, opening_day)[1] for s, _ in parts if s.d[0] <= entry), default=entry)
    days = sorted({d for s, _ in parts for d in s.d if d > entry and bought <= d <= today})
    index = [(entry, 1.0)]
    for d in days:
        v = mix_value_on(parts, history, d)
        if v is not None:
            index.append((d, v))
    return index


def xirr(cfs, unit=365.25):
    """Money-weighted return per `unit` days (default: per year); None without a sign change."""
    t0 = min(d for d, _ in cfs)

    def npv(r):
        return sum(a / (1 + r) ** ((d - t0).days / unit) for d, a in cfs)

    lo, hi = -0.99, 10.0
    if npv(lo) * npv(hi) > 0:
        return None
    for _ in range(200):
        m = (lo + hi) / 2
        if npv(lo) * npv(m) <= 0:
            hi = m
        else:
            lo = m
    return (lo + hi) / 2


def month_key(d):
    return f"{d.year}-{d.month:02d}"


def prev_month(k):
    y, m = int(k[:4]), int(k[5:7])
    return f"{y - 1}-12" if m == 1 else f"{y}-{m - 1:02d}"


def make_cpi(cpi, flows, today):
    """-> (cpi_now, cpi_at, filled) or None if a flow month lies before the first CPI month.

    cpi_now is the CPI of `today`'s month. Months after the last published one take its value,
    months missing inside the series the previous published one; `filled` lists the missing
    inside months that a flow or `today` falls into."""
    if not cpi:
        return None
    first_month, last_month = min(cpi), max(cpi)

    def cpi_at(d):
        k = month_key(d)
        if k > last_month:
            return cpi[last_month]
        if k < first_month:
            raise PriceError("inflation_missing")
        while k not in cpi:
            k = prev_month(k)
        return cpi[k]

    days = [d for d, _ in flows] + [today]
    try:
        for d in days:
            cpi_at(d)
    except PriceError:
        return None
    filled = sorted({month_key(d) for d in days if month_key(d) <= last_month} - set(cpi))
    return cpi_at(today), cpi_at, filled


def report(name, value, executed, shortfalls, uninvested_until, today, cpi, unit, dd):
    invested = sum(a for _, a in executed)
    cfs = [(d, -a) for d, a in executed]
    out = {
        "name": name,
        "invested": invested,
        "deposits": sum(a for _, a in executed if a > 0),
        "withdrawals": -sum(a for _, a in executed if a < 0),
        "value": value,
        "gain": value - invested,
        "irr": xirr(cfs + [(today, value)], unit),
        "gainReal": None,
        "irrReal": None,
        "shortfall": sum(a for _, a in shortfalls),
        "shortfalls": [{"date": d.isoformat(), "amount": a} for d, a in shortfalls],
        "uninvestedUntil": uninvested_until,
        "drawdown": dd,
    }
    if cpi is not None:
        cpi_now, cpi_at, _ = cpi
        real = [(d, a * cpi_now / cpi_at(d)) for d, a in cfs]
        out["gainReal"] = value + sum(a for _, a in real)
        out["irrReal"] = xirr(real + [(today, value)], unit)
    warnings = set()
    if out["shortfall"] > 0.005:
        warnings.add("withdrawal_uncovered")
    if uninvested_until is not None:
        warnings.add("late_start")
    out["warnings"] = sorted(warnings)
    return out


def run(fx):
    today = D(fx["today"])
    flows = net_flows(window_flows(fx["flows"], today, fx.get("start")))
    cpi = make_cpi(fx.get("cpi"), flows, today)
    span = (today - flows[0][0]).days if flows else 0
    unit = 365.25 if span >= 365 else max(span, 1)
    opening_day = D(fx["start"]["date"]) if fx.get("start") else None
    out = {
        "investedNominal": sum(a for _, a in flows),
        "investedReal": None,
        "cpiError": None,
        "cpiFilled": [],
        "mwrPeriodDays": None if span >= 365 else max(span, 1),
        "variants": [],
    }
    if fx.get("cpi") and cpi is None:
        out["cpiError"] = "inflation_missing"
    if cpi is not None:
        cpi_now, cpi_at, out["cpiFilled"] = cpi
        out["investedReal"] = sum(a * cpi_now / cpi_at(d) for d, a in flows)
    for v in fx["variants"]:
        try:
            if v["kind"] == "mix":
                value, executed, shortfalls, until, _ = simulate_mix(flows, v, today, opening_day)
                mix_dd = drawdown(mix_index(v, flows, today, opening_day))
            else:
                value, executed, shortfalls, until = simulate(flows, v, today, opening_day)
        except PriceError as e:
            out["variants"].append({"name": v["name"], "error": str(e)})
            continue
        if v["kind"] == "cash":
            dd = dict(NO_DRAWDOWN)
        elif v["kind"] == "mix":
            dd = mix_dd
        else:
            dd = drawdown(asset_index(v, flows, today, opening_day))
        out["variants"].append(report(v["name"], value, executed, shortfalls, until, today, cpi, unit, dd))
    if "actual" in fx:
        dd = drawdown(actual_index(fx, today))
        out["actual"] = report("actual", fx["actual"]["value"], flows, [], None, today, cpi, unit, dd)
    return out


if __name__ == "__main__":
    with open(sys.argv[1]) as fh:
        print(json.dumps(run(json.load(fh)), indent=1))
