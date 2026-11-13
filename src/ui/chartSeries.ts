import { isError } from '../core/types';
import type { Row } from '../model/analysis';
import type { Translate } from '../model/messages';
import { rowName } from './i18n';

export interface ChartSeries {
  key: string;
  name: string;
  color: string;
  width: number;
  dash?: string;
}

export const NET_KEY = 'net';
export type ChartMode = 'value' | 'difference';

/** Cash equals cumulative net deposits only if every withdrawal was covered. Keep its row key so selection
 * and booking markers still address the same series after merging the reference. */
export function chartSeries(rows: Row[], colors: Map<string, string>, selected: string, mode: ChartMode, t: Translate): ChartSeries[] {
  const combined = mode === 'value' ? rows.find((r) =>
    r.variantKind === 'cash' && !isError(r.result) && r.result.shortfall === 0 && colors.has(r.key),
  ) : undefined;
  const out: ChartSeries[] = mode === 'value' && !combined
    ? [{ key: NET_KEY, name: t('chart.netDeposited'), color: 'var(--muted-foreground)', width: 1.5, dash: '5 4' }]
    : [];
  for (const r of rows) {
    const color = colors.get(r.key);
    if (isError(r.result) || !color) continue;
    const name = rowName(t, r);
    out.push({
      key: r.key,
      name: r === combined ? t('chart.cashAndNetDeposited', { name, netDeposited: t('chart.netDeposited') }) : name,
      color,
      width: r.kind === 'actual' ? 2 : 1.5,
      // Only the merged line takes the reference's dash: a separate cash line stays solid, so it is not mistaken
      // for net deposits (value mode) or the zero line (difference mode), which share its colour and dash.
      ...(r === combined ? { dash: '5 4' } : {}),
    });
  }
  const sel = out.findIndex((s) => s.key === selected);
  if (sel >= 0) {
    const [s] = out.splice(sel, 1);
    out.push({ ...s, width: s.width + 0.5 });
  }
  return out;
}
