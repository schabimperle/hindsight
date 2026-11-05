import { scaleLog } from 'd3-scale';

export type ChartScale = 'linear' | 'log';

/** A log domain must stay positive; inspect only series actually plotted, ignoring missing quotes. */
export function logAxis(chart: Record<string, number | string | null>[], keys: string[], money: (v: number) => string): {
  domain: [number, number];
  ticks: number[];
} | null {
  let min = Infinity;
  let max = -Infinity;
  for (const point of chart) {
    for (const key of keys) {
      const value = point[key];
      if (typeof value !== 'number') continue;
      if (!Number.isFinite(value) || value <= 0) return null;
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
  }
  if (min === Infinity) return null;
  const axis = scaleLog().domain(min === max ? [min / 2, max * 2] : [min, max]);
  // The host rounds amounts to whole currency units, even on very narrow or sub-unit ranges.
  const labels = new Set<string>();
  const ticks = axis.ticks(5).filter((value) => {
    const label = money(value);
    if (labels.has(label)) return false;
    labels.add(label);
    return true;
  });
  return { domain: axis.domain() as [number, number], ticks };
}
