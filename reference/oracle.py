"""Reference model (oracle) for the 'Hindsight' Wealthfolio addon.

Single-asset counterfactuals vs. the real portfolio, before taxes and fees, nominal and in
today's purchasing power (CPI of one country), with XIRR. The TypeScript core must reproduce
this model.

Input: JSON fixture on argv[1]; output: JSON results on stdout.
Fixture (all amounts in the base currency):
  {"today": "YYYY-MM-DD",
   "flows": [{"date": "YYYY-MM-DD", "amount": float}],    # + into the portfolio, - out of it
   "variants": [{"name": str, "kind": "asset"|"cash",
                 "points": [["YYYY-MM-DD", price], ...]}],  # prices already in base currency
   "cpi": {"YYYY-MM": float} | null,                        # null: no real figures; gaps allowed
   "actual": {"value": float},                              # optional: the real portfolio
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
"""

import bisect
import datetime as dt
import json
import sys

D = dt.date.fromisoformat
MAX_PRICE_GAP_DAYS = 10  # holidays plus the odd missing quote
EPS = 1e-9


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


def report(name, value, executed, shortfalls, uninvested_until, today, cpi, unit):
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
            value, executed, shortfalls, until = simulate(flows, v, today, opening_day)
        except PriceError as e:
            out["variants"].append({"name": v["name"], "error": str(e)})
            continue
        out["variants"].append(report(v["name"], value, executed, shortfalls, until, today, cpi, unit))
    if "actual" in fx:
        out["actual"] = report("actual", fx["actual"]["value"], flows, [], None, today, cpi, unit)
    return out


if __name__ == "__main__":
    with open(sys.argv[1]) as fh:
        print(json.dumps(run(json.load(fh)), indent=1))
