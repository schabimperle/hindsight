import { describe, expect, it } from 'vitest';
import { actualIndex, assetIndex, drawdown, type IndexPoint } from '../src/core/drawdown';
import { run, runDetailed } from '../src/core/report';
import { Series } from '../src/core/series';
import type { Fixture, Report } from '../src/core/types';

const levels = (xs: number[]): IndexPoint[] => xs.map((x, i) => [`2024-01-${String(i + 1).padStart(2, '0')}`, x]);

describe('drawdown on an index', () => {
  it('no fall: max 0 without dates', () => {
    expect(drawdown(levels([1, 1, 1.2, 1.3]))).toEqual({ max: 0, peak: null, trough: null });
  });

  it('a first falling step counts and stays open', () => {
    expect(drawdown(levels([1, 0.9]))).toEqual({ max: expect.closeTo(-0.1, 12), peak: '2024-01-01', trough: '2024-01-02' });
  });

  it('recovers on the first day back at the peak', () => {
    const dd = drawdown(levels([1, 0.8, 0.9, 1.0, 1.1]));
    expect(dd).toEqual({ max: expect.closeTo(-0.2, 12), peak: '2024-01-01', trough: '2024-01-02' });
  });

  it('a deeper later fall replaces a recovered one', () => {
    const dd = drawdown(levels([1, 0.9, 1.05, 0.7]));
    expect(dd).toEqual({ max: expect.closeTo(0.7 / 1.05 - 1, 12), peak: '2024-01-03', trough: '2024-01-04' });
  });

  it('a plateau at the peak moves the peak date', () => {
    expect(drawdown(levels([1, 1, 0.5]))?.peak).toBe('2024-01-02');
  });

  it('null without an index', () => {
    expect(drawdown(null)).toBeNull();
  });
});

describe('asset index', () => {
  // Fri 100, Mon 80, Tue 100: a Saturday deposit buys on Monday at 80.
  const series = new Series([
    ['2024-03-01', 100],
    ['2024-03-04', 80],
    ['2024-03-05', 100],
  ]);

  it('starts at the price the first investment was made at', () => {
    const idx = assetIndex(series, [{ date: '2024-03-02', amount: 100 }], '2024-03-05');
    expect(idx).toEqual([
      ['2024-03-04', 1],
      ['2024-03-05', 1.25],
    ]);
    expect(drawdown(idx)?.max).toBe(0);
  });

  it('a window opening on Saturday uses the last price before it as base, dated on the opening day', () => {
    const idx = assetIndex(series, [{ date: '2024-03-02', amount: 100 }], '2024-03-05', '2024-03-02');
    expect(idx[0]).toEqual(['2024-03-02', 1]);
    expect(drawdown(idx)).toEqual({ max: expect.closeTo(-0.2, 12), peak: '2024-03-02', trough: '2024-03-04' });
  });

  it('an uncovered withdrawal before the first deposit does not start the index', () => {
    const s = new Series([
      ['2024-01-01', 100],
      ['2024-01-03', 50],
      ['2024-01-04', 55],
    ]);
    const idx = assetIndex(s, [{ date: '2024-01-01', amount: -10 }, { date: '2024-01-03', amount: 100 }], '2024-01-04');
    expect(idx[0]).toEqual(['2024-01-03', 1]);
    expect(drawdown(idx)?.max).toBe(0);
  });

  it('a late start begins at the first price', () => {
    expect(assetIndex(series, [{ date: '2024-02-01', amount: 100 }], '2024-03-05')[0]).toEqual(['2024-03-01', 1]);
  });
});

describe('real portfolio index', () => {
  const fx = (flows: Fixture['flows'], daily: [string, number][], value: number, today: string, start?: Fixture['start']): Fixture => ({
    today,
    flows,
    variants: [],
    actual: { value, daily },
    ...(start ? { start } : {}),
  });

  it('a deposit counts at the start of its day, a withdrawal at its end (not netted)', () => {
    const idx = actualIndex(
      fx(
        [
          { date: '2024-01-01', amount: 100 },
          { date: '2024-01-02', amount: 100 },
          { date: '2024-01-02', amount: -100 },
        ],
        [['2024-01-01', 100]],
        120,
        '2024-01-02',
      ),
    );
    // (120 + 100 - 100 - 100) / (100 + 100) = 10 %, not 20 % as the netted flow would give.
    expect(idx).toEqual([
      ['2024-01-01', 1],
      ['2024-01-02', expect.closeTo(1.1, 12)],
    ]);
  });

  it('skips the steps before the first positive value', () => {
    const idx = actualIndex(fx([{ date: '2024-01-02', amount: 100 }], [['2024-01-02', 100], ['2024-01-03', 90]], 99, '2024-01-04'));
    expect(idx?.[0]).toEqual(['2024-01-02', 1]);
    expect(drawdown(idx)?.max).toBeCloseTo(-0.1, 12);
  });

  it('an emptied portfolio pauses; a new deposit restarts without a jump', () => {
    const idx = actualIndex(
      fx(
        [
          { date: '2024-01-01', amount: 100 },
          { date: '2024-01-02', amount: -100 },
          { date: '2024-01-04', amount: 50 },
        ],
        [
          ['2024-01-01', 100],
          ['2024-01-02', 0],
          ['2024-01-03', 0],
          ['2024-01-04', 50],
        ],
        55,
        '2024-01-05',
      ),
    );
    expect(idx?.map(([, l]) => l)).toEqual([1, 1, 1, 1, expect.closeTo(1.1, 12)]);
    expect(drawdown(idx)?.max).toBe(0);
  });

  it('a booking on a day without valuation makes the index unavailable', () => {
    expect(actualIndex(fx([{ date: '2024-01-01', amount: 100 }, { date: '2024-01-03', amount: 10 }], [['2024-01-01', 100]], 110, '2024-01-04'))).toBeNull();
  });

  it('a window starts at the opening value; its bookings are after the start day', () => {
    const idx = actualIndex(fx([{ date: '2024-01-01', amount: 999 }], [['2024-01-02', 90]], 100, '2024-01-03', { date: '2024-01-01', value: 100 }));
    expect(idx).toEqual([
      ['2024-01-01', 1],
      ['2024-01-02', expect.closeTo(0.9, 12)],
      ['2024-01-03', expect.closeTo(1, 12)],
    ]);
  });

  it('without daily valuations there is no drawdown', () => {
    const f = fx([{ date: '2024-01-01', amount: 100 }], [], 100, '2024-01-02');
    delete f.actual?.daily;
    expect(actualIndex(f)).toBeNull();
  });
});

describe('run', () => {
  const fx: Fixture = {
    today: '2024-03-05',
    flows: [{ date: '2024-03-01', amount: 100 }],
    variants: [
      { name: 'A', kind: 'asset', points: [['2024-03-01', 100], ['2024-03-04', 80], ['2024-03-05', 90]] },
      { name: 'Cash', kind: 'cash', points: [] },
    ],
  };

  it('reports the drawdown per variant; cash never falls', () => {
    const out = run(fx);
    expect((out.variants[0] as Report).drawdown).toEqual({ max: expect.closeTo(-0.2, 12), peak: '2024-03-01', trough: '2024-03-04' });
    expect((out.variants[1] as Report).drawdown).toEqual({ max: 0, peak: null, trough: null });
  });

  it('does not depend on the chart sampling', () => {
    const a = runDetailed(fx, (first) => [first, fx.today]).out;
    const b = runDetailed(fx, () => ['2024-03-04']).out;
    expect(a.variants.map((v) => (v as Report).drawdown)).toEqual(b.variants.map((v) => (v as Report).drawdown));
  });
});
