import { normalizeCurrency } from '../core/currency';
import { Series } from '../core/series';
import type { PricePoint } from '../core/types';
import { DataError, type FetchDeps } from './http';
import { fetchYahooSeries } from './yahoo';

interface FxEntry {
  series: Series | null;
  error: string | null;
  staleHours: number | null;
}

/**
 * Daily exchange rates into the base currency via Yahoo pairs `<CCY><BASE>=X` (same host, same
 * cache as the prices). Each currency is loaded once; `rate` is synchronous afterwards.
 */
export class FxRates {
  private readonly entries = new Map<string, Promise<FxEntry>>();
  private readonly done = new Map<string, FxEntry>();

  constructor(
    private readonly deps: FetchDeps,
    readonly base: string,
    private readonly from: string,
  ) {}

  ensure(ccy: string): Promise<FxEntry> {
    const code = normalizeCurrency(ccy).code;
    if (code === this.base) return Promise.resolve({ series: null, error: null, staleHours: null });
    let p = this.entries.get(code);
    if (!p) {
      p = (async (): Promise<FxEntry> => {
        let e: FxEntry;
        try {
          const r = await fetchYahooSeries(this.deps, `${code}${this.base}=X`, this.from);
          e = {
            series: r.points.length > 0 ? new Series(r.points) : null,
            error: r.points.length > 0 ? null : 'fx_rate_missing',
            staleHours: r.stale ? (this.deps.nowMs() - r.fetchedAt) / 3600000 : null,
          };
        } catch (err) {
          e = { series: null, error: err instanceof DataError && err.code === 'prices_unavailable' ? 'prices_unavailable' : 'fx_rate_missing', staleHours: null };
        }
        this.done.set(code, e);
        return e;
      })();
      this.entries.set(code, p);
    }
    return p;
  }

  /** Value of 1 unit of `ccy` (main currency) in base currency on or before `day` (gap at most 10 days). */
  rate(ccy: string, day: string): number | null {
    const code = normalizeCurrency(ccy).code;
    if (code === this.base) return 1;
    return this.done.get(code)?.series?.onOrBeforeWithin(day) ?? null;
  }

  /** Largest cache age (hours) of the loaded exchange rates, null if all are fresh. */
  staleHours(): number | null {
    let max: number | null = null;
    for (const e of this.done.values()) if (e.staleHours !== null) max = Math.max(max ?? 0, e.staleHours);
    return max;
  }
}

export interface BaseSeries {
  points: PricePoint[];
  error: string | null;
}

/** Converts a price series in currency `ccy` (also GBp etc.) into the base currency: price x exchange
 * rate on the same day (or up to 10 days before); days without an exchange rate are dropped. */
export async function toBase(fx: FxRates, points: PricePoint[], ccy: string): Promise<BaseSeries> {
  const { code, factor } = normalizeCurrency(ccy);
  if (code === fx.base) return { points: factor === 1 ? points : points.map(([d, p]) => [d, p === null ? null : p * factor]), error: null };
  const e = await fx.ensure(code);
  if (e.error) return { points: [], error: e.error };
  const out: PricePoint[] = [];
  for (const [d, p] of points) {
    if (p === null) continue;
    const r = fx.rate(code, d);
    if (r !== null) out.push([d, p * factor * r]);
  }
  return { points: out, error: out.length === 0 ? 'fx_rate_missing' : null };
}
