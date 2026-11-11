/**
 * Largest-Triangle-Three-Buckets (Steinarsson 2013), the downsampling behind ECharts' and Chart.js' line
 * decimation: picks `threshold` of the given points so the drawn line keeps its peaks and troughs.
 * Returns positions into `xs`/`ys`, ascending, first and last included.
 */
export function lttb(xs: number[], ys: number[], threshold: number): number[] {
  const n = xs.length;
  if (threshold >= n || threshold < 3) return xs.map((_, i) => i);
  const out = [0];
  const size = (n - 2) / (threshold - 2);
  let a = 0;
  for (let b = 0; b < threshold - 2; b++) {
    // Average of the next bucket is the third corner of the triangle.
    const nextStart = Math.floor((b + 1) * size) + 1;
    const nextEnd = Math.min(Math.floor((b + 2) * size) + 1, n);
    let avgX = 0;
    let avgY = 0;
    for (let i = nextStart; i < nextEnd; i++) { avgX += xs[i]; avgY += ys[i]; }
    avgX /= nextEnd - nextStart;
    avgY /= nextEnd - nextStart;
    let best = -1;
    let bestArea = -1;
    for (let i = Math.floor(b * size) + 1; i < nextStart; i++) {
      const area = Math.abs((xs[a] - avgX) * (ys[i] - ys[a]) - (xs[a] - xs[i]) * (avgY - ys[a]));
      if (area > bestArea) { bestArea = area; best = i; }
    }
    out.push(best);
    a = best;
  }
  out.push(n - 1);
  return out;
}

export type ChartRow = Record<string, number | string | null | undefined> & { time: number };

/**
 * Chart rows with each line thinned to about `threshold` points by LTTB; `keep` rows stay on every line (marker
 * days). A row keeps only the values of the lines that use it, the others are left out and bridged by
 * `connectNulls`. `full` is the untouched row for the tooltip.
 */
export function thinRows<R extends ChartRow>(rows: R[], keys: string[], threshold: number, keep: (row: R) => boolean = () => false): (R & { full: R })[] {
  if (rows.length <= threshold) return rows.map((row) => ({ ...row, full: row }));
  const used = new Map<number, Set<string>>();
  const mark = (i: number, key: string) => { if (!used.has(i)) used.set(i, new Set()); used.get(i)!.add(key); };
  for (const key of keys) {
    const at = rows.flatMap((row, i) => (typeof row[key] === 'number' ? [i] : []));
    const picked = lttb(at.map((i) => rows[i].time), at.map((i) => rows[i][key] as number), threshold);
    for (const p of picked) mark(at[p], key);
    for (const i of at) if (keep(rows[i])) mark(i, key);
  }
  return [...used.keys()].sort((x, y) => x - y).map((i) => {
    const row = rows[i];
    const thinned: ChartRow = { ...row };
    for (const key of keys) if (!used.get(i)!.has(key)) delete thinned[key];
    return { ...(thinned as R), full: row };
  });
}
