import { dayNumber } from './dates';

/** Money-weighted return per `unit` days (default: per 365.25-day year); null without a sign change. */
export function xirr(cfs: [string, number][], unit = 365.25): number | null {
  let t0 = Infinity;
  for (const [d] of cfs) t0 = Math.min(t0, dayNumber(d));
  const rows = cfs.map(([d, a]) => [(dayNumber(d) - t0) / unit, a] as const);
  const npv = (r: number): number => {
    let s = 0;
    for (const [t, a] of rows) s += a / Math.pow(1 + r, t);
    return s;
  };
  let lo = -0.99;
  let hi = 10.0;
  if (npv(lo) * npv(hi) > 0) return null;
  for (let i = 0; i < 200; i++) {
    const m = (lo + hi) / 2;
    if (npv(lo) * npv(m) <= 0) hi = m;
    else lo = m;
  }
  return (lo + hi) / 2;
}
