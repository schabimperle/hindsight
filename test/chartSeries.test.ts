import { describe, expect, it } from 'vitest';
import type { Flow } from '../src/core/types';
import en from '../src/i18n/en.json';
import { analyze, type Analysis } from '../src/model/analysis';
import type { Translate } from '../src/model/messages';
import { chartSeries, NET_KEY } from '../src/ui/chartSeries';

const t: Translate = (key, options) => {
  const value = key.split('.').reduce<unknown>((obj, part) => (obj as Record<string, unknown>)[part], en) as string;
  return value.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name]));
};

function analysis(flows: Flow[] = [{ date: '2025-01-01', amount: 1000 }, { date: '2025-06-01', amount: -200 }], from: string | null = null): Analysis {
  return analyze({
    flows, flowWarnings: [], unvalued: [], unconverted: [], country: null, cpi: null, cpiError: null, fxStaleHours: null,
    benchmarks: [{ def: { name: '', ticker: '', kind: 'cash' }, points: null, currency: 'EUR', firstDay: null, error: null, staleHours: null }],
    real: {
      baseCurrency: 'EUR', timeZone: 'Europe/Berlin', accountIds: ['A'], asOf: '2026-01-01', value: 1200,
      netContribution: flows.reduce((sum, f) => sum + f.amount, 0), activities: [], heldValue: {}, quotes: {}, quoteCurrencies: {},
      daily: [{ date: '2025-07-01', value: 900 }], valuationDays: [['2025-07-01']], historyMissing: false,
    },
  }, { from, to: null });
}
const colorsFor = (a: Analysis) => new Map(a.rows.map((r, i) => [r.key, `color-${i}`]));

describe('cash and net-deposit chart reference', () => {
  it.each([null, '2025-07-01'])('merges equivalent lines, including an opening valuation (%s)', (from) => {
    const a = analysis(undefined, from);
    expect(a.fatal).toBeNull();
    const cash = a.rows.find((r) => r.variantKind === 'cash')!;
    for (const pt of a.chart) expect(pt[cash.key]).toBeCloseTo(pt.net as number, 8);
    const series = chartSeries(a.rows, colorsFor(a), cash.key, 'value', t);
    expect(series.map((s) => s.key)).toEqual(['actual', cash.key]);
    expect(series.at(-1)).toMatchObject({ name: 'Not invested / Net deposits', dash: '5 4', color: 'color-1', width: 2 });
  });

  it('keeps different lines after an uncovered withdrawal, even when net deposits become positive again', () => {
    const a = analysis([
      { date: '2025-01-01', amount: 1000 }, { date: '2025-06-01', amount: -1500 }, { date: '2025-08-01', amount: 1000 },
    ]);
    const cash = a.rows.find((r) => r.variantKind === 'cash')!;
    expect(a.chart.at(-1)).toMatchObject({ net: 500, [cash.key]: 1000 });
    const series = chartSeries(a.rows, colorsFor(a), 'actual', 'value', t);
    expect(series.find((s) => s.key === NET_KEY)).toMatchObject({ name: 'Net deposits', dash: '5 4' });
    expect(series.find((s) => s.key === cash.key)).toMatchObject({ name: 'Not invested', dash: '5 4' });
  });

  it('keeps the reference when cash is removed or cannot be plotted', () => {
    const a = analysis();
    for (const rows of [a.rows.filter((r) => r.kind === 'actual'), a.rows.map((r) => r.variantKind === 'cash' ? { ...r, result: { name: '', error: 'no_prices' } } : r)]) {
      expect(chartSeries(rows, colorsFor(a), 'actual', 'value', t).map((s) => s.key)).toEqual([NET_KEY, 'actual']);
    }
    expect(chartSeries(a.rows, new Map([['actual', 'blue']]), 'actual', 'value', t).map((s) => s.key)).toEqual([NET_KEY, 'actual']);
  });

  it('keeps cash as its own comparison in difference mode without a net-deposit reference', () => {
    const a = analysis();
    const cash = a.rows.find((r) => r.variantKind === 'cash')!;
    const series = chartSeries(a.rows, colorsFor(a), 'actual', 'difference', t);
    expect(series.map((s) => s.key)).toEqual([cash.key, 'actual']);
    expect(series[0]).toMatchObject({ name: 'Not invested', dash: '5 4' });
  });

  it('preserves a stored custom cash name in the combined label', () => {
    const a = analysis();
    a.rows.find((r) => r.variantKind === 'cash')!.name = 'Savings';
    expect(chartSeries(a.rows, colorsFor(a), 'actual', 'value', t)[0].name).toBe('Savings / Net deposits');
  });
});
