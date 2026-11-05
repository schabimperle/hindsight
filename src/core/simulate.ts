import { addDays, daysBetween, monthEnd, yearOf } from './dates';
import { PriceError, Series } from './series';
import type { Flow, PathPoint, Shortfall, Variant } from './types';

const EPS = 1e-9;

export interface SingleResult {
  value: number;
  /** Flows actually executed (covered part of the withdrawals). */
  executed: Flow[];
  shortfalls: Shortfall[];
  uninvestedUntil: string | null;
  /** Value on each sample day (last point: today); display only. */
  path: PathPoint[];
}

/** Month ends from the month of the first cash flow until today (last entry = today). */
export function monthEnds(first: string, today: string): string[] {
  const out: string[] = [];
  let y = yearOf(first);
  let m = Number(first.slice(5, 7));
  for (;;) {
    const e = monthEnd(y, m);
    if (e >= today) break;
    out.push(e);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  out.push(today);
  return out;
}

/** Chart days from `first` to `today` (last entry = today): daily up to ~13 months, weekly up to ~6 years,
 * month ends beyond, so short windows still get a usable line and long ones stay light. */
export function sampleDays(first: string, today: string): string[] {
  const span = daysBetween(first, today);
  if (span > 6 * 366) return monthEnds(first, today);
  const step = span > 400 ? 7 : 1;
  const out: string[] = [];
  for (let d = first; d < today; d = addDays(d, step)) out.push(d);
  out.push(today);
  return out;
}

/** Holding after a flow: cash (before the first price) or units. */
interface Holding {
  day: string;
  cash: number;
  units: number;
}

function buildPath(flows: Flow[], days: string[], history: Holding[], series: Series | null): PathPoint[] {
  if (flows.length === 0) return [];
  const out: PathPoint[] = [];
  let hi = 0;
  let cur: Holding = { day: '', cash: 0, units: 0 };
  for (const day of days) {
    while (hi < history.length && history[hi].day <= day) cur = history[hi++];
    if (series === null || cur.units <= 1e-12) {
      out.push({ date: day, value: cur.cash });
      continue;
    }
    const p = series.onOrBeforeWithin(day);
    if (p !== null) out.push({ date: day, value: cur.units * p });
  }
  return out;
}

/** Simulates a variant over the (netted, sorted) flows; see reference/oracle.py. */
/** `openingDay`: the window's opening deposit buys at the last price on or before that day (the real opening
 * value is a close of that day or before it), else like any deposit. */
export function simulateSingle(flows: Flow[], variant: Variant, today: string, days?: string[], openingDay?: string): SingleResult {
  const chartDays = days ?? (flows.length > 0 ? monthEnds(flows[0].date, today) : []);
  const executed: Flow[] = [];
  const shortfalls: Shortfall[] = [];
  const history: Holding[] = [];
  let cash = 0;
  let units = 0;

  const withdrawCash = (day: string, amount: number): void => {
    const take = Math.min(-amount, cash);
    cash -= take;
    if (take > EPS) executed.push({ date: day, amount: -take });
    if (-amount - take > EPS) shortfalls.push({ date: day, amount: -amount - take });
  };

  if (variant.kind === 'cash') {
    for (const f of flows) {
      if (f.amount > 0) {
        cash += f.amount;
        executed.push(f);
      } else {
        withdrawCash(f.date, f.amount);
      }
      history.push({ day: f.date, cash, units: 0 });
    }
    return { value: cash, executed, shortfalls, uninvestedUntil: null, path: buildPath(flows, chartDays, history, null) };
  }

  const series = new Series(variant.points);
  const first = series.d[0];
  if (first > today) throw new PriceError('no_prices');
  let started = false;
  let uninvestedUntil: string | null = null;
  const start = (): void => {
    started = true;
    units += cash / series.p[0];
    cash = 0;
    history.push({ day: first, cash: 0, units });
  };

  for (const f of flows) {
    const day = f.date;
    const a = f.amount;
    if (!started && day >= first) start();
    if (!started) {
      uninvestedUntil = first;
      if (a > 0) {
        cash += a;
        executed.push(f);
      } else {
        withdrawCash(day, a);
      }
      history.push({ day, cash, units: 0 });
      continue;
    }
    const p = (day === openingDay ? series.onOrBeforeWithin(day) : null) ?? series.tradePrice(day);
    if (a > 0) {
      units += a / p;
      executed.push(f);
    } else if (-a / p <= units * (1 + 1e-12)) {
      units = Math.max(0, units + a / p);
      executed.push(f);
    } else {
      const covered = units * p;
      units = 0;
      if (covered > EPS) executed.push({ date: day, amount: -covered });
      shortfalls.push({ date: day, amount: -a - covered });
    }
    history.push({ day, cash: 0, units });
  }
  if (!started) start();
  const value = units * series.last(today);
  return { value, executed, shortfalls, uninvestedUntil, path: buildPath(flows, chartDays, history, series) };
}
