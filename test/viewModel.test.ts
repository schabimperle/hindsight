import { describe, expect, it } from 'vitest';
import { makeCpi, report as calculateReport } from '../src/core/report';
import type { Report } from '../src/core/types';
import type { Row } from '../src/model/analysis';
import { makeFormat } from '../src/model/format';
import { buildRowViews, headlineFor } from '../src/ui/viewModel';

const report = (name: string, value: number, invested: number, gainReal: number | null = value - invested - 200): Report => ({
  name,
  invested,
  deposits: invested,
  withdrawals: 0,
  value,
  gain: value - invested,
  irr: 0.1,
  gainReal,
  irrReal: gainReal === null ? null : 0.05,
  shortfall: 0,
  shortfalls: [],
  uninvestedUntil: null,
  drawdown: null,
  warnings: [],
});
const row = (key: string, kind: Row['kind'], result: Row['result']): Row => ({
  key,
  name: key,
  kind,
  variantKind: kind === 'actual' ? null : 'asset',
  result,
  warnings: [],
  path: [],
});

const rows: Row[] = [
  row('b0', 'benchmark', report('b0', 1500, 1000)),
  row('b1', 'benchmark', { name: 'b1', error: 'prices_unavailable' }),
  row('actual', 'actual', report('actual', 1300, 1000)),
  // uncovered withdrawal: less executed, hence higher gain at a smaller value
  row('b2', 'benchmark', report('b2', 1200, 600)),
];

describe('headlineFor', () => {
  it('values real gains in end-period purchasing power without deflating the end value twice', () => {
    const flows = [{ date: '2024-01-01', amount: 1000 }];
    const cpi = makeCpi({ '2024-01': 100, '2025-01': 110 }, flows, '2025-01-01');
    const actual = calculateReport('actual', 1200, flows, [], null, '2025-01-01', cpi);
    const alternative = calculateReport('alternative', 1500, flows, [], null, '2025-01-01', cpi);
    expect(headlineFor(actual, 'nominal').gain).toBe(200);
    expect(headlineFor(actual, 'real')).toMatchObject({ value: 1200, gain: 100 });
    expect(actual.irrReal).toBeLessThan(actual.irr!);
    const rows = [row('actual', 'actual', actual), row('b', 'benchmark', alternative)];
    expect(buildRowViews(rows, 'nominal')[1].diff).toBe(300);
    expect(buildRowViews(rows, 'real')[1].diff).toBe(300);
  });

  it('adjusts the spread when an alternative could not cover a withdrawal', () => {
    const flows = [{ date: '2024-01-01', amount: 1000 }, { date: '2024-06-01', amount: -500 }];
    const cpi = makeCpi({ '2024-01': 100, '2024-06': 100, '2025-01': 110 }, flows, '2025-01-01');
    const actual = calculateReport('actual', 800, flows, [], null, '2025-01-01', cpi);
    const alternative = calculateReport('alternative', 0, [{ date: '2024-01-01', amount: 1000 },
      { date: '2024-06-01', amount: -300 }], [{ date: '2024-06-01', amount: 200 }], null, '2025-01-01', cpi);
    const rows = [row('actual', 'actual', actual), row('b', 'benchmark', alternative)];
    expect(buildRowViews(rows, 'nominal')[1].diff).toBe(-1000);
    expect(buildRowViews(rows, 'real')[1].diff).toBe(-1020);
  });

  it('picks the matching figures per view; the value stays the same', () => {
    const r = report('x', 1500, 1000);
    expect(headlineFor(r, 'nominal')).toEqual({ value: 1500, gain: 500, irr: 0.1 });
    expect(headlineFor(r, 'real')).toEqual({ value: 1500, gain: 300, irr: 0.05 });
  });
});

describe('buildRowViews', () => {
  it('pins the real portfolio on top and sorts by the view\'s gain', () => {
    expect(buildRowViews(rows, 'nominal').map((v) => v.row.key)).toEqual(['actual', 'b2', 'b0', 'b1']);
  });
  it('“vs. your portfolio” is the gain difference, not the value difference', () => {
    const v = buildRowViews(rows, 'nominal');
    expect(v[0].diff).toBeNull();
    expect(v.find((x) => x.row.key === 'b0')?.diff).toBe(200);
    expect(v.find((x) => x.row.key === 'b2')?.diff).toBe(300);
    expect(buildRowViews(rows, 'real').find((x) => x.row.key === 'b2')?.diff).toBe(300);
  });
  it('without real figures no difference in the Real view', () => {
    const noReal = [row('actual', 'actual', report('actual', 1300, 1000, null)), row('b0', 'benchmark', report('b0', 1500, 1000, null))];
    expect(buildRowViews(noReal, 'real')[1].diff).toBeNull();
  });
  it('puts error rows last with a reason and no figures', () => {
    const last = buildRowViews(rows, 'nominal').at(-1);
    expect(last?.error).toBe('prices_unavailable');
    expect(last?.headline).toBeNull();
    expect(last?.diff).toBeNull();
  });
});

describe('formatting by language and base currency', () => {
  it('German, euro', () => {
    const f = makeFormat('de', 'EUR');
    expect(f.moneySigned(1234)).toMatch(/^\+1\.234\s€$/);
    expect(f.moneySigned(-5)).toMatch(/^[-−]5\s€$/);
    expect(f.moneySigned(0.2)).toMatch(/^0\s€$/);
    expect(f.pctSigned(-0.00001)).toMatch(/^0,0\s%$/);
    expect(f.pctSigned(0.128)).toMatch(/^\+12,8\s%$/);
    expect(f.pctSigned(null)).toBe('–');
    expect(f.date('2026-09-01')).toBe('01.09.2026');
    expect(f.month('2026-09')).toBe('09/2026');
    expect(f.money(1_500_000)).toMatch(/^1\.500\.000\s€$/);
  });
  it('English, US dollar and yen; unknown code stays readable', () => {
    expect(makeFormat('en', 'USD').money(1234.4)).toBe('$1,234');
    expect(makeFormat('en', 'USD').money(120_000)).toBe('$120,000');
    expect(makeFormat('en', 'JPY').money(1234)).toBe('¥1,234');
    expect(makeFormat('en', 'XBTX').money(5)).toBe('5 XBTX');
  });
  it('host formatting locales: German UI with en-US numbers keeps German country names', () => {
    const f = makeFormat('de', 'EUR', { numbers: 'en-US', money: 'en-US' });
    expect(f.money(43_622.4)).toBe('€43,622');
    expect(f.date('2026-11-03')).toBe('11/03/2026');
    expect(f.pctSigned(0.123)).toBe('+12.3%');
    expect(f.country('DEU')).toBe('Deutschland');
  });
});
