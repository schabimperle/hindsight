import { isError, type Report } from '../core/types';
import type { Row } from '../model/analysis';

/** View that determines which figures are the headline figures everywhere. */
export type ViewMode = 'nominal' | 'real';

export interface Headline {
  value: number;
  gain: number | null;
  irr: number | null;
}

export function headlineFor(r: Report, view: ViewMode): Headline {
  if (view === 'nominal') return { value: r.value, gain: r.gain, irr: r.irr };
  // An amount from today is already in today's purchasing power; in real terms only gain and p.a. differ.
  return { value: r.value, gain: r.gainReal, irr: r.irrReal };
}

export interface RowView {
  row: Row;
  isActual: boolean;
  report: Report | null;
  /** Error code if the variant cannot be computed. */
  error: string | null;
  headline: Headline | null;
  /** Gain minus the real portfolio's gain in the view (null for the real portfolio itself or without a comparison value). */
  diff: number | null;
}

/** Real portfolio first, then by the view's gain descending, uncomputable variants last. */
export function buildRowViews(rows: Row[], view: ViewMode): RowView[] {
  const actualRow = rows.find((r) => r.kind === 'actual');
  const actualHead = actualRow && !isError(actualRow.result) ? headlineFor(actualRow.result, view) : null;
  const views = rows.map<RowView>((row) => {
    const isActual = row.kind === 'actual';
    const report = isError(row.result) ? null : row.result;
    const headline = report ? headlineFor(report, view) : null;
    const diff =
      !isActual && headline && actualHead && headline.gain !== null && actualHead.gain !== null ? headline.gain - actualHead.gain : null;
    return { row, isActual, report, error: isError(row.result) ? row.result.error : null, headline, diff };
  });
  const rank = (v: RowView): number => (v.isActual ? 2 : v.headline ? 1 : 0);
  const score = (v: RowView): number => v.headline?.gain ?? v.headline?.value ?? 0;
  return views
    .map((v, i) => ({ v, i }))
    .sort((a, b) => {
      const ra = rank(a.v);
      const rb = rank(b.v);
      if (ra !== rb) return rb - ra;
      if (a.v.headline && b.v.headline && score(a.v) !== score(b.v)) return score(b.v) - score(a.v);
      return a.i - b.i;
    })
    .map(({ v }) => v);
}
