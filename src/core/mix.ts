import { daysBetween, yearOf } from './dates';
import { MAX_PRICE_GAP_DAYS } from './gap';
import type { IndexPoint } from './drawdown';
import { PriceError, Series } from './series';
import type { Flow, PathPoint, Shortfall, Variant } from './types';

const EPS = 1e-9;

/** A mix's state after the events of a day (one entry per component). */
interface MixState {
  day: string;
  cash: number[];
  units: number[];
}

export interface MixResult {
  value: number;
  executed: Flow[];
  shortfalls: Shortfall[];
  uninvestedUntil: string | null;
  history: MixState[];
}

interface Part {
  series: Series;
  weight: number;
}

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

/** Components with their weights normalised to sum 1. */
export function mixParts(variant: Variant): Part[] {
  const comps = variant.components ?? [];
  const total = comps.reduce((s, c) => s + c.weight, 0);
  return comps.map((c) => ({ series: new Series(c.points), weight: c.weight / total }));
}

/** [price, price day] a component trades at on `day` (the single-asset rules). */
function mixPrice(series: Series, day: string, openingDay?: string): [number, string] {
  if (day === openingDay) {
    const p = series.onOrBeforeWithin(day);
    if (p !== null) return [p, day];
  }
  const p = series.tradePrice(day);
  const i = bisectLeft(series.d, day);
  return [p, i < series.d.length ? series.d[i] : day];
}

/** Days on which the yearly rebalance happens (see reference/oracle.py). */
function rebalanceDays(parts: Part[], firstFlow: string, today: string): string[] {
  const out: string[] = [];
  for (let y = yearOf(firstFlow) + 1; y <= yearOf(today); y++) {
    const jan1 = `${y}-01-01`;
    const due: (string | null)[] = [];
    for (const { series: s } of parts) {
      if (s.d[0] >= jan1) continue;
      const k = bisectLeft(s.d, jan1);
      if (k < s.d.length && daysBetween(jan1, s.d[k]) > MAX_PRICE_GAP_DAYS) throw new PriceError('prices_missing');
      due.push(k < s.d.length ? s.d[k] : null);
    }
    if (due.length === 0 || due.includes(null)) continue;
    const day = (due as string[]).reduce((m, d) => (d > m ? d : m));
    if (day <= today) out.push(day);
  }
  return out;
}

/** Simulates a fixed mix over the (netted, sorted) flows; see reference/oracle.py. */
export function simulateMix(flows: Flow[], variant: Variant, today: string, openingDay?: string): MixResult {
  const parts = mixParts(variant);
  const n = parts.length;
  if (parts.some((p) => p.series.d[0] > today)) throw new PriceError('no_prices');
  if (flows.length === 0) return { value: 0, executed: [], shortfalls: [], uninvestedUntil: null, history: [] };
  const firstFlow = flows[0].date;
  let cash = new Array<number>(n).fill(0);
  let units = new Array<number>(n).fill(0);
  const started = parts.map((p) => p.series.d[0] <= firstFlow);
  type Event = { day: string; order: 0 | 1 | 2; i?: number; amount?: number };
  const events: Event[] = [];
  parts.forEach((p, i) => {
    if (p.series.d[0] > firstFlow) events.push({ day: p.series.d[0], order: 0, i });
  });
  if (variant.rebalance === 'yearly') for (const day of rebalanceDays(parts, firstFlow, today)) events.push({ day, order: 1 });
  for (const f of flows) events.push({ day: f.date, order: 2, amount: f.amount });
  // Stable sort: by day, then starts, rebalance, flows (each group keeps its own order).
  events.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.order - b.order));
  const executed: Flow[] = [];
  const shortfalls: Shortfall[] = [];
  const history: MixState[] = [];
  let uninvestedUntil: string | null = null;
  for (const e of events) {
    if (e.order === 0) {
      const i = e.i as number;
      units[i] += cash[i] / parts[i].series.p[0];
      cash[i] = 0;
      started[i] = true;
    } else if (e.order === 1) {
      const prices = parts.map((p, i) => (started[i] ? (p.series.onOrBeforeWithin(e.day) as number) : 0));
      const total = parts.reduce((s, _, i) => s + (started[i] ? units[i] * prices[i] : cash[i]), 0);
      if (total > EPS) {
        parts.forEach((p, i) => {
          if (started[i]) units[i] = (total * p.weight) / prices[i];
          else cash[i] = total * p.weight;
        });
      }
    } else {
      const a = e.amount as number;
      if (a > 0) {
        executed.push({ date: e.day, amount: a });
        parts.forEach((p, i) => {
          if (started[i]) units[i] += (a * p.weight) / mixPrice(p.series, e.day, openingDay)[0];
          else {
            cash[i] += a * p.weight;
            const first = p.series.d[0];
            uninvestedUntil = uninvestedUntil === null || first > uninvestedUntil ? first : uninvestedUntil;
          }
        });
      } else {
        const total = parts.reduce((s, p, i) => s + (started[i] ? units[i] * mixPrice(p.series, e.day, openingDay)[0] : cash[i]), 0);
        if (total > 0 && -a <= total * (1 + 1e-12)) {
          const keep = Math.max(0, 1 - -a / total);
          units = units.map((u) => u * keep);
          cash = cash.map((c) => c * keep);
          executed.push({ date: e.day, amount: a });
        } else {
          units = new Array<number>(n).fill(0);
          cash = new Array<number>(n).fill(0);
          if (total > EPS) executed.push({ date: e.day, amount: -total });
          shortfalls.push({ date: e.day, amount: -a - total });
        }
      }
    }
    history.push({ day: e.day, cash: [...cash], units: [...units] });
  }
  let value = cash.reduce((s, c) => s + c, 0);
  parts.forEach((p, i) => {
    if (units[i] > 0) value += units[i] * p.series.last(today);
  });
  return { value, executed, shortfalls, uninvestedUntil, history };
}

/** Value of the latest state on or before `day`; null if a held component has no price then. */
export function mixValueOn(parts: Part[], history: MixState[], day: string): number | null {
  let state: MixState | null = null;
  for (const h of history) {
    if (h.day > day) break;
    state = h;
  }
  if (state === null) return 0;
  let total = state.cash.reduce((s, c) => s + c, 0);
  for (let i = 0; i < parts.length; i++) {
    if (state.units[i] > 1e-12) {
      const p = parts[i].series.onOrBeforeWithin(day);
      if (p === null) return null;
      total += state.units[i] * p;
    }
  }
  return total;
}

/** Chart path of a mix on the sample days (days without a price for a held component are left out). */
export function mixPath(variant: Variant, history: MixState[], days: string[]): PathPoint[] {
  if (history.length === 0) return [];
  const parts = mixParts(variant);
  const out: PathPoint[] = [];
  for (const day of days) {
    const v = mixValueOn(parts, history, day);
    if (v !== null) out.push({ date: day, value: v });
  }
  return out;
}

/** The strategy's time-weighted index: one unit from the first deposit day on (see reference/oracle.py). */
export function mixIndex(variant: Variant, flows: Flow[], today: string, openingDay?: string): IndexPoint[] | null {
  const parts = mixParts(variant);
  const entry = flows.find((f) => f.amount > 0)?.date;
  if (entry === undefined) return null;
  const { history } = simulateMix([{ date: entry, amount: 1 }], variant, today, openingDay);
  const bought = parts
    .filter((p) => p.series.d[0] <= entry)
    .map((p) => mixPrice(p.series, entry, openingDay)[1])
    .reduce((m, d) => (d > m ? d : m), entry);
  const days = [...new Set(parts.flatMap((p) => p.series.d.filter((d) => d > entry && d >= bought && d <= today)))].sort();
  const index: IndexPoint[] = [[entry, 1]];
  for (const d of days) {
    const v = mixValueOn(parts, history, d);
    if (v !== null) index.push([d, v]);
  }
  return index;
}
