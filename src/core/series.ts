import { daysBetween } from './dates';
import { MAX_PRICE_GAP_DAYS } from './gap';
import type { PricePoint } from './types';

export class PriceError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'PriceError';
  }
}

/** First index whose day is >= x (Python `bisect_left`). */
export function bisectLeft(a: readonly string[], x: string): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** First index whose day is > x (Python `bisect_right`). */
export function bisectRight(a: readonly string[], x: string): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (x < a[mid]) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

export class Series {
  readonly d: string[];
  readonly p: number[];

  constructor(points: PricePoint[]) {
    const pts = points
      .filter((pt): pt is [string, number] => pt[1] !== null && pt[1] !== undefined)
      .map((pt) => [pt[0], Number(pt[1])] as [string, number])
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));
    if (pts.length === 0) throw new PriceError('no_prices');
    this.d = pts.map((pt) => pt[0]);
    this.p = pts.map((pt) => pt[1]);
  }

  /** Price for a flow on `day`: first price on or after `day`, at most MAX_PRICE_GAP_DAYS later.
   * Without any later price (flow on today's weekend, today before the close), the last one on or
   * before `day` if at most MAX_PRICE_GAP_DAYS old. Else PriceError. */
  tradePrice(day: string): number {
    const i = bisectLeft(this.d, day);
    if (i >= this.d.length) {
      if (daysBetween(this.d[this.d.length - 1], day) <= MAX_PRICE_GAP_DAYS) return this.p[this.p.length - 1];
      throw new PriceError('prices_missing');
    }
    if (daysBetween(day, this.d[i]) > MAX_PRICE_GAP_DAYS) throw new PriceError('prices_missing');
    return this.p[i];
  }

  /** Last price on or before `day`, only if at most MAX_PRICE_GAP_DAYS old; else null. */
  onOrBeforeWithin(day: string): number | null {
    const i = bisectRight(this.d, day) - 1;
    if (i < 0 || daysBetween(this.d[i], day) > MAX_PRICE_GAP_DAYS) return null;
    return this.p[i];
  }

  /** Price closest to `day` (before or after, tie: before), at most MAX_PRICE_GAP_DAYS away. */
  nearestWithin(day: string): number | null {
    const b = bisectRight(this.d, day) - 1;
    const a = bisectLeft(this.d, day);
    const before = b >= 0 ? daysBetween(this.d[b], day) : Infinity;
    const after = a < this.d.length ? daysBetween(day, this.d[a]) : Infinity;
    const best = Math.min(before, after);
    if (best > MAX_PRICE_GAP_DAYS) return null;
    return before <= after ? this.p[b] : this.p[a];
  }

  /** Last price on or before `today` (the window end), at most MAX_PRICE_GAP_DAYS old. */
  last(today: string): number {
    const i = bisectRight(this.d, today) - 1;
    if (i < 0 || daysBetween(this.d[i], today) > MAX_PRICE_GAP_DAYS) throw new PriceError('prices_stale');
    return this.p[i];
  }
}
