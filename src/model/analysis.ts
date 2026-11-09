import { crossCheck } from '../core/flows';
import { runDetailed } from '../core/report';
import { sampleDays } from '../core/simulate';
import {
  isError,
  type BookingRef,
  type Fixture,
  type Flow,
  type PathPoint,
  type Report,
  type Variant,
  type VariantKind,
  type VariantResult,
  type WarningItem,
} from '../core/types';
import type { BenchmarkData, CpiData } from '../sources/load';
import { addDays, daysBetween } from '../core/dates';
import { MAX_PRICE_GAP_DAYS } from '../core/gap';
import { pointOn, valueOn, type RealPortfolio } from '../sources/portfolio';

export type { WarningItem };

export interface AnalysisInput {
  /** One flow per booking (not netted). */
  flows: Flow[];
  flowWarnings: WarningItem[];
  unvalued: BookingRef[];
  /** Foreign-currency bookings without an exchange rate: block the analysis. */
  unconverted: BookingRef[];
  country: string | null;
  cpi: CpiData | null;
  cpiError: string | null;
  fxStaleHours: number | null;
  benchmarks: BenchmarkData[];
  real: RealPortfolio;
}

/** Analysed period: `from` null = since the first flow, `to` null = today (latest valuation). */
export interface Window {
  from: string | null;
  to: string | null;
}

export const ALL_TIME: Window = { from: null, to: null };

export interface Row {
  key: string;
  /** Name from the settings; empty for “Not invested” without a custom name. */
  name: string;
  kind: 'actual' | 'benchmark';
  variantKind: VariantKind | null;
  result: VariantResult;
  warnings: WarningItem[];
  path: PathPoint[];
}

export interface Analysis {
  fatal: WarningItem | null;
  /** Further blocking errors besides `fatal` (show all booking lists at once). */
  moreFatal: WarningItem[];
  /** Window end (today unless a custom end date lies before it). */
  today: string;
  /** Window start: the opening day, else the first flow. */
  start: string | null;
  /** Value of the real portfolio at the end of the opening day; null without an opening value (all time). */
  openingValue: number | null;
  /** Day of the first flow overall (start of the "All" range). */
  firstEver: string | null;
  /** null: money-weighted returns per year; else over the window of this many days. */
  mwrPeriodDays: number | null;
  baseCurrency: string;
  /** Number of deposit and withdrawal bookings in the period (before netting per day). */
  depositCount: number;
  withdrawalCount: number;
  investedNominal: number;
  /** null without inflation data. */
  investedReal: number | null;
  country: string | null;
  rows: Row[];
  headerWarnings: WarningItem[];
  /** Value per row key and day, plus the cumulative net deposits (`net`) and the booking counts. */
  chart: Record<string, number | string | null>[];
  /** Same days and booking counts; per row key the gain so far (value minus the net of that row's own executed
   * flows up to the day), `net` always 0. */
  gainChart: Record<string, number | string | null>[];
  /** Same days and booking counts; per row key its gain so far minus the real portfolio's (null where either is
   * missing), so the real portfolio is the zero line; `net` always 0. Today's point is the nominal gain difference. */
  diffChart: Record<string, number | string | null>[];
}

/** A hint appears once the inflation data lag behind by this many months. */
export const CPI_LAG_HINT_MONTHS = 4;

const blank = (fatal: WarningItem | null, today: string, real: RealPortfolio, partial: Partial<Analysis> = {}): Analysis => ({
  fatal,
  moreFatal: [],
  today,
  start: null,
  openingValue: null,
  firstEver: null,
  mwrPeriodDays: null,
  baseCurrency: real.baseCurrency,
  depositCount: 0,
  withdrawalCount: 0,
  investedNominal: 0,
  investedReal: null,
  country: null,
  rows: [],
  headerWarnings: [],
  chart: [],
  gainChart: [],
  diffChart: [],
  ...partial,
});

/** Row key from the benchmark's identity (not its position), so expanded rows and the chart selection
 * stay with the same variant when adding, removing or reordering. Duplicates get a counter so that
 * React keys stay unique. */
export function benchKeys(defs: { ticker: string; name: string; kind: string }[]): string[] {
  const seen = new Map<string, number>();
  return defs.map((d) => {
    const base = `b:${d.kind}:${d.ticker}:${d.name}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}#${n}`;
  });
}

/** Total valuations on the days on which every account that has started its history has a valuation of its own:
 * on other days the total carries an account's older state forward, which would turn into returns. Empty when an
 * account has no history at all. */
export function coveredDaily(real: RealPortfolio, today: string): [string, number][] {
  if (real.historyMissing) return [];
  const sets = real.valuationDays.filter((d) => d.length > 0).map((d) => ({ first: d[0], days: new Set(d) }));
  return real.daily
    .filter((p) => p.date < today && sets.every((s) => p.date < s.first || s.days.has(p.date)))
    .map((p) => [p.date, p.value]);
}

/** The ends of the real portfolio's time-weighted index must be covered too: the opening day (its value is the
 * index base) and a custom end (latest valuations are current by definition). Otherwise there is no drawdown. */
function endsCovered(real: RealPortfolio, daily: [string, number][], opening: string | null, today: string): boolean {
  const days = new Set(daily.map(([d]) => d));
  if (opening !== null && !days.has(opening)) return false;
  if (today === real.asOf) return true;
  return coveredDaily(real, addDays(today, 1)).some(([d]) => d === today);
}

/** Running sum of `flows` (sorted by date) on and before each of the sorted `days`. */
export function cumulativeOn(flows: Flow[], days: string[]): number[] {
  let fi = 0;
  let cum = 0;
  return days.map((d) => {
    while (fi < flows.length && flows[fi].date <= d) cum += flows[fi++].amount;
    return cum;
  });
}

const monthIndex = (ym: string): number => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;

/** Warnings of a variant with parameters (shortfall, late start; for a mix only some of the money waited). */
function rowWarnings(r: Report, kind: VariantKind): WarningItem[] {
  const out: WarningItem[] = [];
  if (r.warnings.includes('withdrawal_uncovered')) {
    out.push({
      code: 'withdrawal_uncovered',
      params: { amount: { money: r.shortfall }, date: { date: r.shortfalls[0]?.date ?? '' }, count: r.shortfalls.length },
    });
  }
  if (r.warnings.includes('late_start') && r.uninvestedUntil) {
    out.push({ code: kind === 'mix' ? 'late_start_partial' : 'late_start', params: { date: { date: r.uninvestedUntil } } });
  }
  return out;
}

export function analyze(input: AnalysisInput, window: Window = ALL_TIME): Analysis {
  const { real } = input;
  const keys = benchKeys(input.benchmarks.map((b) => b.def));
  const asOf = real.asOf ?? '';
  const today = window.to !== null && window.to < asOf ? window.to : asOf;
  const allFlows = input.flows.filter((f) => f.date <= asOf);
  const firstEver = allFlows.reduce<string | null>((m, f) => (m === null || f.date < m ? f.date : m), null);
  const blankAll = (fatal: WarningItem, partial: Partial<Analysis> = {}): Analysis => blank(fatal, today, real, { firstEver, ...partial });
  if (real.accountIds.length === 0) return blankAll({ code: 'no_accounts' });
  const blocking: WarningItem[] = [];
  if (input.unvalued.length > 0) blocking.push({ code: 'asset_transfer_unvalued', items: input.unvalued });
  if (input.unconverted.length > 0) {
    blocking.push({ code: 'foreign_currency_no_rate', params: { currency: real.baseCurrency }, items: input.unconverted });
  }
  if (blocking.length > 0) return blankAll(blocking[0], { moreFatal: blocking.slice(1) });
  if (firstEver === null || !today) return blankAll({ code: 'no_deposits' });

  // A start on or before the first flow is the same as all time (nothing was invested before).
  const opening = window.from !== null && window.from > firstEver ? window.from : null;
  if (opening !== null && opening >= today) return blankAll({ code: 'window_empty' });
  // A period ending before the first deposit: nothing was ever invested in it.
  if (today < firstEver) return blankAll({ code: 'no_deposits_window' });
  // Wealthfolio's valuation on (or shortly before) a day: opening value and value at a custom end. Missing, stale
  // or negative values would silently turn into gains, so they block.
  // Every account that already has valuations must have one at most 10 days before the day (the total carries
  // each account's last state forward, so one stale account would hide in it).
  const fresh = (day: string): boolean =>
    !real.historyMissing &&
    real.valuationDays.every((days) => {
      if (days.length === 0 || days[0] > day) return true;
      const last = days.filter((d) => d <= day).at(-1) as string;
      return daysBetween(last, day) <= MAX_PRICE_GAP_DAYS;
    });
  const usable = (day: string): number | null => {
    const p = pointOn(real.daily, day);
    return p !== null && p.value >= 0 && daysBetween(p.date, day) <= MAX_PRICE_GAP_DAYS && fresh(day) ? p.value : null;
  };
  const openingValue = opening === null ? null : usable(opening);
  const actualAtEnd = today === asOf ? real.value : usable(today);
  if (opening !== null && openingValue === null) return blankAll({ code: 'valuation_missing', params: { date: { date: opening } } });
  if (actualAtEnd === null) return blankAll({ code: 'valuation_missing', params: { date: { date: today } } });
  const flows = allFlows.filter((f) => f.date <= today && (opening === null || f.date > opening));
  if (flows.length === 0 && !(openingValue !== null && openingValue > 0.005)) {
    return blankAll({ code: opening === null && window.to === null ? 'no_deposits' : 'no_deposits_window' });
  }

  const headerWarnings: WarningItem[] = [...input.flowWarnings];
  // All-time check against Wealthfolio's net contribution, independent of the window.
  const cc = crossCheck(allFlows, real.netContribution);
  if (cc) headerWarnings.push(cc);
  if (input.cpiError) headerWarnings.push({ code: input.cpiError });
  if (input.cpi) {
    if (monthIndex(today) - monthIndex(input.cpi.lastMonth) > CPI_LAG_HINT_MONTHS) {
      headerWarnings.push({ code: 'inflation_stale', params: { month: { month: input.cpi.lastMonth } } });
    }
    if (input.cpi.staleHours !== null)
      headerWarnings.push({ code: 'inflation_cache_stale', params: { hours: Math.round(input.cpi.staleHours) } });
  }
  if (input.fxStaleHours !== null) headerWarnings.push({ code: 'fx_rates_cache_stale', params: { hours: Math.round(input.fxStaleHours) } });

  const variants: Variant[] = [];
  const variantOf: (number | null)[] = [];
  input.benchmarks.forEach((b) => {
    const missing = b.def.kind === 'mix' ? !b.components : b.def.kind !== 'cash' && !b.points;
    if (b.error || missing) {
      variantOf.push(null);
      return;
    }
    variantOf.push(variants.length);
    if (b.def.kind === 'mix') {
      variants.push({
        name: b.def.name,
        kind: 'mix',
        points: [],
        rebalance: b.def.rebalance ?? 'yearly',
        ...(b.def.band !== undefined ? { band: b.def.band } : {}),
        components: (b.components ?? []).map((c) => ({ weight: c.weight, points: c.points.filter(([d]) => d <= today) })),
      });
      return;
    }
    variants.push({ name: b.def.name, kind: b.def.kind, points: (b.points ?? []).filter(([d]) => d <= today) });
  });

  const actualValue = actualAtEnd;
  const covered = coveredDaily(real, today);
  const fx: Fixture = {
    today,
    flows,
    variants,
    cpi: input.cpi?.cpi ?? null,
    actual: { value: actualValue, ...(endsCovered(real, covered, opening, today) ? { daily: covered } : {}) },
    ...(opening !== null && openingValue !== null ? { start: { date: opening, value: openingValue } } : {}),
  };
  // Booking days before the first netted flow (bookings netting to zero) still get a point for their markers.
  const chartDays = (first: string): string[] =>
    [...new Set([...sampleDays(first, today), ...flows.filter((f) => f.amount !== 0).map((f) => f.date)])].sort();
  const det = runDetailed(fx, chartDays);
  if (det.out.cpiError && input.cpi) {
    const firstCpi = Object.keys(input.cpi.cpi).reduce((m, k) => (k < m ? k : m));
    headerWarnings.push({
      code: det.out.cpiError,
      params: { country: { country: input.cpi.country }, month: { month: firstCpi }, date: { date: det.flows[0]?.date ?? today } },
    });
  }
  if (det.out.cpiFilled.length > 0) {
    headerWarnings.push({ code: 'inflation_gap', params: { months: { months: det.out.cpiFilled }, count: det.out.cpiFilled.length } });
  }

  const rows: Row[] = [];
  // Executed flows per row: gain so far must subtract what each alternative actually paid in and took out
  // (an uncovered withdrawal never left it), not the real portfolio's flows.
  const executedByKey = new Map<string, Flow[]>([['actual', det.flows]]);
  const actualRes = det.out.actual as VariantResult;
  rows.push({
    key: 'actual',
    name: '',
    kind: 'actual',
    variantKind: null,
    result: actualRes,
    warnings: [],
    path: real.daily,
  });
  input.benchmarks.forEach((b, i) => {
    const vi = variantOf[i];
    const base = { key: keys[i], name: b.def.name, kind: 'benchmark' as const, variantKind: b.def.kind };
    if (vi === null) {
      rows.push({ ...base, result: { name: b.def.name, error: b.error ?? 'prices_unavailable' }, warnings: [], path: [] });
      return;
    }
    const res = det.out.variants[vi];
    const warnings = isError(res) ? [] : rowWarnings(res, b.def.kind);
    if (b.staleHours !== null) warnings.push({ code: 'cache_stale', params: { hours: Math.round(b.staleHours) } });
    rows.push({ ...base, result: res, warnings, path: det.paths[vi] });
    executedByKey.set(keys[i], det.executed[vi]);
  });

  const ends = chartDays(det.flows[0]?.date ?? today);
  const chart: Record<string, number | string | null>[] = ends.map((d) => ({ date: d }));
  const net = cumulativeOn(det.flows, ends);
  chart.forEach((pt, i) => {
    pt.net = net[i];
  });
  // Raw bookings, including days netting to zero, grouped by their actual day.
  let bi = 0;
  const booked = [...flows].sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
  chart.forEach((pt) => {
    for (; bi < booked.length && booked[bi].date <= (pt.date as string); bi++) {
      const f = booked[bi];
      if (f.amount === 0) continue;
      const [count, sum] = f.amount > 0 ? (['depCount', 'depAmount'] as const) : (['wdCount', 'wdAmount'] as const);
      pt[count] = ((pt[count] as number | undefined) ?? 0) + 1;
      pt[sum] = ((pt[sum] as number | undefined) ?? 0) + Math.abs(f.amount);
    }
  });
  for (const row of rows) {
    if (row.kind === 'actual') {
      const first = row.path[0]?.date;
      for (const pt of chart) {
        const d = pt.date as string;
        pt[row.key] = d === today ? actualValue : first !== undefined && d >= first ? valueOn(row.path, d) : null;
      }
      continue;
    }
    const lookup = new Map(row.path.map((p) => [p.date, p.value]));
    for (const pt of chart) pt[row.key] = lookup.get(pt.date as string) ?? null;
  }
  const gainChart = chart.map((pt) => {
    const out: Record<string, number | string | null> = {};
    for (const [k, v] of Object.entries(pt)) if (!executedByKey.has(k)) out[k] = v;
    out.net = 0;
    return out;
  });
  const chartDates = chart.map((pt) => pt.date as string);
  for (const [key, executed] of executedByKey) {
    const cum = cumulativeOn(executed, chartDates);
    chart.forEach((pt, i) => {
      const v = pt[key];
      gainChart[i][key] = typeof v === 'number' ? v - cum[i] : null;
    });
  }

  const diffChart = gainChart.map((pt) => {
    const out = { ...pt };
    const base = pt.actual;
    for (const key of executedByKey.keys()) {
      const v = pt[key];
      out[key] = typeof v === 'number' && typeof base === 'number' ? v - base : null;
    }
    return out;
  });

  return {
    fatal: null,
    moreFatal: [],
    today,
    start: det.flows[0]?.date ?? null,
    openingValue: opening === null ? null : openingValue,
    firstEver,
    mwrPeriodDays: det.out.mwrPeriodDays,
    baseCurrency: real.baseCurrency,
    depositCount: flows.filter((f) => f.amount > 0).length,
    withdrawalCount: flows.filter((f) => f.amount < 0).length,
    investedNominal: det.out.investedNominal,
    investedReal: det.out.investedReal,
    country: input.cpi ? input.country : null,
    rows,
    headerWarnings,
    chart,
    gainChart,
    diffChart,
  };
}
