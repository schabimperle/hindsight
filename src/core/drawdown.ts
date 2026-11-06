import type { Series } from './series';
import type { Drawdown, Fixture, Flow } from './types';

/** Wealthfolio's: a smaller day base pauses the time-weighted index. */
export const MIN_RETURN_BASE = 1;
const PEAK_TOL = 1e-12;
export const NO_DRAWDOWN: Drawdown = { max: 0, peak: null, trough: null, recovery: null };

/** A level of a time-weighted index (1 = start). */
export type IndexPoint = [string, number];

function bisectLeft(a: readonly string[], x: string): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function bisectRight(a: readonly string[], x: string): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (x < a[mid]) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** [index of the price the simulation first invests at, day of that investment] (see `simulateSingle`). The first
 * deposit counts: a withdrawal before it buys nothing. */
export function entryIndex(series: Series, flows: Flow[], openingDay?: string): [number, string] {
  const day = flows.find((f) => f.amount > 0)?.date ?? series.d[0];
  if (day < series.d[0]) return [0, series.d[0]];
  if (day === openingDay && series.onOrBeforeWithin(day) !== null) return [bisectRight(series.d, day) - 1, day];
  const i = Math.min(bisectLeft(series.d, day), series.d.length - 1);
  return [i, series.d[i] > day ? series.d[i] : day];
}

/** An asset's time-weighted index: its price relative to the entry price, from the day of the first investment (a
 * weekend opening keeps Friday's price as base) over every later price day up to `today`. */
export function assetIndex(series: Series, flows: Flow[], today: string, openingDay?: string): IndexPoint[] {
  const [i, day] = entryIndex(series, flows, openingDay);
  const base = series.p[i];
  const out: IndexPoint[] = [[day, 1]];
  for (let j = i + 1; j < series.d.length && series.d[j] <= today; j++) out.push([series.d[j], series.p[j] / base]);
  return out;
}

/** The real portfolio's time-weighted index, or null (see reference/oracle.py). */
export function actualIndex(fx: Fixture): IndexPoint[] | null {
  const actual = fx.actual;
  if (!actual?.daily) return null;
  const today = fx.today;
  const start = fx.start;
  const lo = start?.date;
  const raw = fx.flows.filter((f) => f.date <= today && (lo === undefined || f.date > lo));
  if (raw.length === 0 && !start) return null;
  const first = start ? start.date : raw.reduce((m, f) => (f.date < m ? f.date : m), raw[0].date);
  const daily = [...actual.daily].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const points: [string, number][] = start ? [[first, start.value]] : [];
  for (const [d, v] of daily) if ((start ? first < d : first <= d) && d < today) points.push([d, v]);
  points.push([today, actual.value]);
  const inflow = new Map<string, number>();
  const outflow = new Map<string, number>();
  for (const f of raw) {
    const book = f.amount > 0 ? inflow : outflow;
    book.set(f.date, (book.get(f.date) ?? 0) + Math.abs(f.amount));
  }
  const covered = new Set(points.map(([d]) => d));
  if ([...inflow.keys(), ...outflow.keys()].some((d) => !covered.has(d))) return null;
  const index: IndexPoint[] = [];
  let factor = 1;
  let started = false;
  for (let k = 1; k < points.length; k++) {
    const [d0, v0] = points[k - 1];
    const [d1, v1] = points[k];
    const fin = inflow.get(d1) ?? 0;
    const fout = outflow.get(d1) ?? 0;
    if (!started) {
      if (v0 <= 0) continue;
      started = true;
      index.push([d0, 1]);
    }
    if (v0 < 0 || v1 < 0) return null;
    const base = v0 + fin;
    if (base < 0) return null;
    if (base >= MIN_RETURN_BASE) factor *= 1 + (v1 + fout - v0 - fin) / base;
    index.push([d1, factor]);
  }
  return started ? index : null;
}

/** Maximum drawdown on an index (see reference/oracle.py); null without an index. */
export function drawdown(index: IndexPoint[] | null): Drawdown | null {
  if (!index || index.length === 0) return null;
  let peak = index[0][1];
  let peakDay = index[0][0];
  let worst = 0;
  let atPeak: string | null = null;
  let trough: string | null = null;
  let recovery: string | null = null;
  for (const [day, level] of index) {
    if (level >= peak * (1 - PEAK_TOL)) {
      peak = Math.max(peak, level);
      peakDay = day;
      if (trough !== null && recovery === null) recovery = day;
      continue;
    }
    const dd = level / peak - 1;
    if (dd < worst) {
      worst = dd;
      atPeak = peakDay;
      trough = day;
      recovery = null;
    }
  }
  if (trough === null) return { ...NO_DRAWDOWN };
  return { max: worst, peak: atPeak, trough, recovery };
}
