import { dayNumber } from './dates';

/** Search brackets, tried in order: the usual one first (so ordinary results never depend on the widening), then wider
 * ones for returns beyond +1000 % or -99 % (e.g. a sharp move shortly after a large deposit, annualised). */
const BRACKETS: [number, number][] = [
  [-0.99, 10],
  [-0.999, 100],
  [-0.9999, 1000],
  [-0.9999, 10000],
];

/** Money-weighted return per `unit` days (default: per 365.25-day year); null without a sign change in any
 * bracket. */
export function xirr(cfs: [string, number][], unit = 365.25): number | null {
  let t0 = Infinity;
  for (const [d] of cfs) t0 = Math.min(t0, dayNumber(d));
  const rows = cfs.map(([d, a]) => [(dayNumber(d) - t0) / unit, a] as const);
  const npv = (r: number): number => {
    let s = 0;
    for (const [t, a] of rows) s += a / Math.pow(1 + r, t);
    return s;
  };
  for (const [l, h] of BRACKETS) {
    const ends = npv(l) * npv(h);
    if (!Number.isFinite(ends) || ends > 0) continue;
    let lo = l;
    let hi = h;
    for (let i = 0; i < 200; i++) {
      const m = (lo + hi) / 2;
      if (npv(lo) * npv(m) <= 0) hi = m;
      else lo = m;
    }
    return (lo + hi) / 2;
  }
  return null;
}
