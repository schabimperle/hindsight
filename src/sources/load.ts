import { normalizeCurrency } from '../core/currency';
import { addDays, toDay } from '../core/dates';
import { deriveFlows, type FlowsResult } from '../core/flows';
import { Series } from '../core/series';
import type { PricePoint } from '../core/types';
import { countryById, defaultCountry } from '../model/countries';
import type { AddonSettings, BenchmarkDef } from '../model/settings';
import { FxRates, toBase } from './fx';
import { DataError, type FetchDeps } from './http';
import { fetchCpi } from './oecd';
import { loadRealPortfolio, mapLimit, type PortfolioApi, type RealPortfolio } from './portfolio';
import { fetchYahooSeries } from './yahoo';

export interface BenchmarkData {
  def: BenchmarkDef;
  /** Prices in base currency. */
  points: PricePoint[] | null;
  /** Currency of the ticker (main currency). */
  currency: string | null;
  /** First price day in the loaded series. */
  firstDay: string | null;
  /** Error code of the data layer (e.g. fx_rate_missing). */
  error: string | null;
  /** Age of the cache in hours if the fetch failed. */
  staleHours: number | null;
  /** Mix only: each component's prices in base currency with its weight (percent); null on an error. */
  components?: { weight: number; points: PricePoint[] }[] | null;
}

export interface CpiData {
  country: string;
  cpi: Record<string, number>;
  lastMonth: string;
  staleHours: number | null;
}

export interface LoadedData {
  real: RealPortfolio;
  flows: FlowsResult;
  benchmarks: BenchmarkData[];
  /** Country of the CPI (chosen or automatic); null = none determinable. */
  country: string | null;
  cpi: CpiData | null;
  cpiError: string | null;
  fxStaleHours: number | null;
}

const FLOW_TYPES = new Set(['DEPOSIT', 'WITHDRAWAL', 'TRANSFER_IN', 'TRANSFER_OUT']);
const staleOf = (deps: FetchDeps, r: { stale: boolean; fetchedAt: number }): number | null =>
  r.stale ? (deps.nowMs() - r.fetchedAt) / 3600000 : null;

export async function loadAll(
  api: PortfolioApi,
  deps: FetchDeps,
  settings: Pick<AddonSettings, 'accounts' | 'benchmarks'>,
  onProgress?: (step: string) => void,
): Promise<LoadedData> {
  const real = await loadRealPortfolio(api, settings.accounts, onProgress);
  const base = real.baseCurrency;
  const selected = new Set(real.accountIds);
  const relevant = real.activities.filter(
    (a) => selected.has(a.accountId) && FLOW_TYPES.has(a.activityType) && (a.status === undefined || a.status === 'POSTED'),
  );
  const firstActivity = relevant.reduce<string | null>((m, a) => {
    const d = toDay(a.date, real.timeZone);
    return m === null || d < m ? d : m;
  }, null);
  // The CPI country is always automatic (Wealthfolio time zone, else base currency).
  const country = defaultCountry(real.timeZone, base);
  const fx = new FxRates(deps, base, addDays(firstActivity ?? real.asOf ?? '2000-01-01', -10));

  // Preload exchange rates for bookings and Wealthfolio quotes in a foreign currency.
  onProgress?.('fx');
  const currencies = new Set<string>();
  for (const a of relevant) if (a.currency) currencies.add(normalizeCurrency(a.currency).code);
  for (const c of Object.values(real.quoteCurrencies)) currencies.add(normalizeCurrency(c).code);
  currencies.delete(base);
  await Promise.all([...currencies].map((c) => fx.ensure(c)));

  const quoteSeries = new Map<string, Series>();
  for (const [id, pts] of Object.entries(real.quotes)) {
    const conv = await toBase(fx, pts, real.quoteCurrencies[id] ?? base);
    const positive = conv.points.filter(([, p]) => p !== null && p > 0);
    if (positive.length > 0) quoteSeries.set(id, new Series(positive));
  }
  const flows = deriveFlows(real.activities, selected, {
    base,
    timeZone: real.timeZone,
    fx: (ccy, day) => fx.rate(ccy, day),
    // Closest price to the booking day, before or after, at most 10 days away (tie: the earlier one): an
    // asset that only arrives in Wealthfolio with the transfer often has prices only from the next day.
    quoteOn: (id, day) => quoteSeries.get(id)?.nearestWithin(day) ?? null,
    // Worthless = no value in the selected accounts today and never a Wealthfolio price > 0 (e.g. spam token).
    // The transfer then does not count; later sale proceeds show up as gain of the real portfolio.
    worthless: (id) => !((real.heldValue[id] ?? 0) > 0) && !(real.quotes[id] ?? []).some(([, p]) => p !== null && p > 0),
  });

  const first = flows.flows[0]?.date;
  if (!first) {
    return { real, flows, benchmarks: [], country, cpi: null, cpiError: null, fxStaleHours: fx.staleHours() };
  }

  onProgress?.('benchmarks');
  // One fetch per ticker, shared by single assets and mix components.
  const seriesMemo = new Map<string, Promise<Omit<BenchmarkData, 'def'>>>();
  const tickerData = (ticker: string): Promise<Omit<BenchmarkData, 'def'>> => {
    const key = ticker.toUpperCase();
    let p = seriesMemo.get(key);
    if (!p) {
      p = (async () => {
        try {
          const r = await fetchYahooSeries(deps, ticker, first);
          const conv = await toBase(fx, r.points, r.currency);
          return {
            points: conv.error ? null : conv.points,
            currency: r.currency,
            firstDay: r.points[0]?.[0] ?? null,
            error: conv.error,
            staleHours: staleOf(deps, r),
          };
        } catch (e) {
          return { points: null, currency: null, firstDay: null, staleHours: null, error: e instanceof DataError ? e.code : 'prices_unavailable' };
        }
      })();
      seriesMemo.set(key, p);
    }
    return p;
  };
  const benchmarks = await mapLimit(settings.benchmarks, 3, async (def): Promise<BenchmarkData> => {
    const none = { def, points: null, currency: null, firstDay: null, staleHours: null };
    if (def.kind === 'cash') return { ...none, error: null };
    if (def.kind === 'mix') {
      const parts = await Promise.all((def.components ?? []).map((c) => tickerData(c.ticker)));
      const failed = parts.find((p) => p.error !== null || p.points === null);
      if (failed) return { ...none, error: failed.error ?? 'prices_unavailable', components: null };
      const stale = parts.map((p) => p.staleHours).filter((h): h is number => h !== null);
      return {
        ...none,
        error: null,
        staleHours: stale.length > 0 ? Math.max(...stale) : null,
        components: (def.components ?? []).map((c, i) => ({ weight: c.weight, points: parts[i].points as PricePoint[] })),
      };
    }
    return { def, ...(await tickerData(def.ticker)) };
  });

  onProgress?.('inflation');
  const def = countryById(country);
  if (!def) return { real, flows, benchmarks, country: null, cpi: null, cpiError: null, fxStaleHours: fx.staleHours() };
  try {
    const c = await fetchCpi(deps, def, first);
    return {
      real,
      flows,
      benchmarks,
      country,
      cpi: { country: def.id, cpi: c.cpi, lastMonth: c.lastMonth, staleHours: staleOf(deps, c) },
      cpiError: null,
      fxStaleHours: fx.staleHours(),
    };
  } catch (e) {
    return {
      real,
      flows,
      benchmarks,
      country,
      cpi: null,
      cpiError: e instanceof DataError ? e.code : 'inflation_unavailable',
      fxStaleHours: fx.staleHours(),
    };
  }
}
