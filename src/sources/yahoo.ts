import { normalizeCurrency } from '../core/currency';
import { addDays, toDay } from '../core/dates';
import type { PricePoint } from '../core/types';
import { DataError, HOUR_MS, cachedFetch, storageKey, type Cached, type FetchDeps } from './http';

export const YAHOO_TTL_MS = 12 * HOUR_MS;
export const YAHOO_HEADERS = { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64)', Accept: 'application/json' };
/** Version in the cache key: changes when the shape or meaning of the data changes. */
const CACHE_PREFIX = 'yahoo:v2:';

export interface YahooData {
  /** Main currency (GBp -> GBP), prices converted accordingly. */
  currency: string;
  /** Compact: [trading day, adjusted close]. */
  p: [string, number][];
}

interface ChartResponse {
  chart?: {
    result?: {
      meta?: { currency?: string; exchangeTimezoneName?: string };
      timestamp?: number[];
      indicators?: {
        quote?: { close?: (number | null)[] }[];
        adjclose?: { adjclose?: (number | null)[] }[];
      };
    }[];
    error?: unknown;
  };
}

/**
 * Parses the response of /v8/finance/chart: adjusted closes (`adjclose`, distributions and splits
 * included; without `adjclose` the plain close), trading day in the exchange's time zone, minor
 * units (GBp, ZAc, ILA) converted to the main currency.
 */
export function parseYahooChart(body: string): YahooData {
  let json: ChartResponse;
  try {
    json = JSON.parse(body) as ChartResponse;
  } catch {
    throw new DataError('prices_unavailable');
  }
  const res = json.chart?.result?.[0];
  const ind = res?.indicators;
  const prices = ind?.adjclose?.[0]?.adjclose ?? ind?.quote?.[0]?.close;
  if (!res || !res.timestamp || !prices) throw new DataError('no_prices');
  const raw = res.meta?.currency;
  if (!raw) throw new DataError('currency_unknown');
  const { code, factor } = normalizeCurrency(raw);
  const tz = res.meta?.exchangeTimezoneName || 'UTC';
  const byDay = new Map<string, number>();
  res.timestamp.forEach((ts, i) => {
    const c = prices[i];
    if (c === null || c === undefined || !Number.isFinite(c) || c <= 0) return;
    byDay.set(toDay(new Date(ts * 1000), tz), c * factor);
  });
  const p = [...byDay].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return { currency: code, p };
}

export function yahooUrl(ticker: string, fromDay: string, nowMs: number): string {
  const period1 = Math.floor(Date.parse(`${fromDay}T00:00:00Z`) / 1000);
  const period2 = Math.floor(nowMs / 1000);
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${period1}&period2=${period2}&interval=1d`;
}

export interface TickerSeries {
  points: PricePoint[];
  currency: string;
  fetchedAt: number;
  stale: boolean;
}

/** Price series of a ticker from 10 days before the first cash flow, in the ticker's currency. */
export async function fetchYahooSeries(deps: FetchDeps, ticker: string, firstFlow: string): Promise<TickerSeries> {
  const from = addDays(firstFlow, -10);
  const r: Cached<YahooData> = await cachedFetch<YahooData>(deps, storageKey(CACHE_PREFIX, ticker), from, YAHOO_TTL_MS, async () => {
    const resp = await deps.net.request({
      url: yahooUrl(ticker, from, deps.nowMs()),
      method: 'GET',
      // Yahoo answers 429 to requests without a browser-like User-Agent.
      headers: YAHOO_HEADERS,
      timeoutSecs: 30,
    });
    if (resp.status === 404) throw new DataError('ticker_unknown');
    if (resp.status < 200 || resp.status >= 300) throw new DataError('prices_unavailable');
    return parseYahooChart(resp.body);
  });
  return { points: r.data.p, currency: r.data.currency, fetchedAt: r.fetchedAt, stale: r.stale };
}
