import { daysBetween, pad2 } from './dates';
import { MAX_PRICE_GAP_DAYS } from './gap';
import type { IndexPoint } from './drawdown';
import { bisectLeft, PriceError, Series } from './series';
import { DEFAULT_BAND, type Flow, type PathPoint, type Rebalance, type Shortfall, type Variant } from './types';

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

/** Calendar rules: months per period (periods start on the 1st of a month whose index, Jan = 0, is a multiple). */
const REBALANCE_MONTHS: Partial<Record<Rebalance, number>> = { monthly: 1, quarterly: 3, yearly: 12 };
/** First days of the periods after the one containing `firstFlow`, up to `today`. */
export function periodStarts(firstFlow: string, today: string, months: number): string[] {
  const m = Number(firstFlow.slice(5, 7)) - 1;
  let k = Number(firstFlow.slice(0, 4)) * 12 + Math.floor(m / months) * months + months;
  const out: string[] = [];
  for (;;) {
    const start = `${Math.floor(k / 12)}-${pad2((k % 12) + 1)}-01`;
    if (start > today) return out;
    out.push(start);
    k += months;
  }
}

/** Calendar rebalances: in each new period the first day on which every component started before the period has a
 * price of that period (see reference/oracle.py). */
function rebalanceDays(parts: Part[], firstFlow: string, today: string, months: number): string[] {
  const out: string[] = [];
  for (const start of periodStarts(firstFlow, today, months)) {
    const due: (string | null)[] = [];
    for (const { series: s } of parts) {
      if (s.d[0] >= start) continue;
      const k = bisectLeft(s.d, start);
      if (k < s.d.length && daysBetween(start, s.d[k]) > MAX_PRICE_GAP_DAYS) throw new PriceError('prices_missing');
      due.push(k < s.d.length ? s.d[k] : null);
    }
    if (due.length === 0 || due.includes(null)) continue;
    const day = (due as string[]).reduce((m, d) => (d > m ? d : m));
    if (day <= today) out.push(day);
  }
  return out;
}

/** Threshold rule: every price day of any component after the first flow is a check. */
function checkDays(parts: Part[], firstFlow: string, today: string): string[] {
  return [...new Set(parts.flatMap((p) => p.series.d.filter((d) => d > firstFlow && d <= today)))].sort();
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
  const rule = variant.rebalance;
  // Threshold rule: rebalance once a component's share is more than this far from its weight (absolute).
  const band = (variant.band ?? DEFAULT_BAND) / 100;
  const months = rule === undefined ? undefined : REBALANCE_MONTHS[rule];
  if (months !== undefined) for (const day of rebalanceDays(parts, firstFlow, today, months)) events.push({ day, order: 1 });
  else if (rule === 'threshold') for (const day of checkDays(parts, firstFlow, today)) events.push({ day, order: 1 });
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
      // Valued at the last price on or before the day; cash of a component without prices at face value.
      const prices = parts.map((p, i) => (started[i] ? p.series.onOrBeforeWithin(e.day) : null));
      // Only possible on a threshold check: a component's price is too old to value it.
      if (parts.some((_, i) => started[i] && prices[i] === null)) continue;
      const vals = parts.map((_, i) => (started[i] ? units[i] * (prices[i] as number) : cash[i]));
      const total = vals.reduce((s, v) => s + v, 0);
      if (total <= EPS) continue;
      if (rule === 'threshold' && Math.max(...vals.map((v, i) => Math.abs(v / total - parts[i].weight))) <= band) continue;
      parts.forEach((p, i) => {
        if (started[i]) units[i] = (total * p.weight) / (prices[i] as number);
        else cash[i] = total * p.weight;
      });
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
