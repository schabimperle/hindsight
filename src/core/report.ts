import { daysBetween, pad2 } from './dates';
import { PriceError } from './series';
import { simulateSingle } from './simulate';
import type { Fixture, Flow, PathPoint, Report, RunOutput, Shortfall } from './types';
import { xirr } from './xirr';

const EPS = 1e-9;

export type CpiAt = (day: string) => number;
/** [CPI today, CPI per day, filled months inside the series that a flow falls into]. */
export type Cpi = [number, CpiAt, string[]];

function prevMonth(k: string): string {
  const y = Number(k.slice(0, 4));
  const m = Number(k.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${pad2(m - 1)}`;
}

/** Flows inside the window (start, today], plus the opening deposit on the start day. */
export function windowFlows(flows: Flow[], today: string, start?: { date: string; value: number }): Flow[] {
  const lo = start?.date;
  const out = flows.filter((f) => f.date <= today && (lo === undefined || f.date > lo));
  if (start && start.value > EPS) out.push({ date: start.date, amount: start.value });
  return out;
}

/** Sum per day, sorted by date; days that net to zero are dropped. */
export function netFlows(flows: Flow[]): Flow[] {
  const byDay = new Map<string, number>();
  for (const f of flows) byDay.set(f.date, (byDay.get(f.date) ?? 0) + f.amount);
  return [...byDay]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .filter(([, a]) => Math.abs(a) > EPS)
    .map(([date, amount]) => ({ date, amount }));
}

/** CPI, or null if a flow month lies before the first CPI month. "Now" is `today`'s month (the window end).
 * Months after the last published one take its value, months missing inside the series take the last
 * published one before them. */
export function makeCpi(cpi: Record<string, number> | null | undefined, flows: Flow[], today: string): Cpi | null {
  if (!hasCpi(cpi)) return null;
  const keys = Object.keys(cpi);
  const firstMonth = keys.reduce((m, k) => (k < m ? k : m), keys[0]);
  const lastMonth = keys.reduce((m, k) => (k > m ? k : m), keys[0]);
  const cpiAt: CpiAt = (day) => {
    let k = day.slice(0, 7);
    if (k > lastMonth) return cpi[lastMonth];
    if (k < firstMonth) throw new PriceError('inflation_missing');
    while (!(k in cpi)) k = prevMonth(k);
    return cpi[k];
  };
  const days = [...flows.map((f) => f.date), today];
  try {
    for (const d of days) cpiAt(d);
  } catch {
    return null;
  }
  const filled = new Set<string>();
  for (const d of days) {
    const k = d.slice(0, 7);
    if (k <= lastMonth && !(k in cpi)) filled.add(k);
  }
  return [cpiAt(today), cpiAt, [...filled].sort()];
}

const hasCpi = (cpi: Record<string, number> | null | undefined): cpi is Record<string, number> => !!cpi && Object.keys(cpi).length > 0;

export function report(
  name: string,
  value: number,
  executed: Flow[],
  shortfalls: Shortfall[],
  uninvestedUntil: string | null,
  today: string,
  cpi: Cpi | null,
  unit = 365.25,
): Report {
  const invested = executed.reduce((s, f) => s + f.amount, 0);
  // Executed flows are netted per day, so a deposit and a withdrawal on the same day count as one of them.
  const deposits = executed.reduce((s, f) => s + Math.max(f.amount, 0), 0);
  const withdrawals = executed.reduce((s, f) => s - Math.min(f.amount, 0), 0);
  const cfs = executed.map((f) => [f.date, -f.amount] as [string, number]);
  let gainReal: number | null = null;
  let irrReal: number | null = null;
  if (cpi !== null) {
    const [cpiNow, cpiAt] = cpi;
    const real = cfs.map(([d, a]) => [d, (a * cpiNow) / cpiAt(d)] as [string, number]);
    gainReal = value + real.reduce((s, [, a]) => s + a, 0);
    irrReal = xirr([...real, [today, value]], unit);
  }
  const shortfall = shortfalls.reduce((s, x) => s + x.amount, 0);
  const warnings: string[] = [];
  if (shortfall > 0.005) warnings.push('withdrawal_uncovered');
  if (uninvestedUntil !== null) warnings.push('late_start');
  return {
    name,
    invested,
    deposits,
    withdrawals,
    value,
    gain: value - invested,
    irr: xirr([...cfs, [today, value]], unit),
    gainReal,
    irrReal,
    shortfall,
    shortfalls,
    uninvestedUntil,
    warnings: warnings.sort(),
  };
}

export interface DetailedRun {
  out: RunOutput;
  /** Value path per variant (same index as out.variants), display only. */
  paths: PathPoint[][];
  /** Netted flows the computation is based on. */
  flows: Flow[];
}

/** `days`: chart sample days for the paths (default: month ends from the first flow). */
export function runDetailed(fx: Fixture, days?: (firstFlow: string) => string[]): DetailedRun {
  const today = fx.today;
  const flows = netFlows(windowFlows(fx.flows, today, fx.start));
  const cpi = makeCpi(fx.cpi, flows, today);
  // Per year from 365 days on, else over the window itself (as Wealthfolio's Performance page).
  const span = flows.length > 0 ? daysBetween(flows[0].date, today) : 0;
  const unit = span >= 365 ? 365.25 : Math.max(span, 1);
  const out: RunOutput = {
    investedNominal: flows.reduce((s, f) => s + f.amount, 0),
    investedReal: null,
    cpiError: hasCpi(fx.cpi) && cpi === null ? 'inflation_missing' : null,
    cpiFilled: cpi === null ? [] : cpi[2],
    mwrPeriodDays: span >= 365 ? null : Math.max(span, 1),
    variants: [],
  };
  if (cpi !== null) {
    const [cpiNow, cpiAt] = cpi;
    out.investedReal = flows.reduce((s, f) => s + (f.amount * cpiNow) / cpiAt(f.date), 0);
  }
  const paths: PathPoint[][] = [];
  const chartDays = days && flows.length > 0 ? days(flows[0].date) : undefined;
  for (const v of fx.variants) {
    let sim;
    try {
      sim = simulateSingle(flows, v, today, chartDays, fx.start?.date);
    } catch (e) {
      if (e instanceof PriceError) {
        out.variants.push({ name: v.name, error: e.code });
        paths.push([]);
        continue;
      }
      throw e;
    }
    out.variants.push(report(v.name, sim.value, sim.executed, sim.shortfalls, sim.uninvestedUntil, today, cpi, unit));
    paths.push(sim.path);
  }
  if (fx.actual) out.actual = report('actual', fx.actual.value, flows, [], null, today, cpi, unit);
  return { out, paths, flows };
}

/** Computes a fixture and returns the same JSON shape as reference/oracle.py. */
export function run(fx: Fixture): RunOutput {
  return runDetailed(fx).out;
}
