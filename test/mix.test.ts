import { describe, expect, it } from 'vitest';
import { drawdown } from '../src/core/drawdown';
import { mixIndex, mixParts, mixValueOn, periodStarts, simulateMix } from '../src/core/mix';
import type { PricePoint, Rebalance, Variant } from '../src/core/types';

const mix = (rebalance: Rebalance, ...comps: [number, PricePoint[]][]): Variant => ({
  name: 'Mix',
  kind: 'mix',
  points: [],
  rebalance,
  components: comps.map(([weight, points]) => ({ weight, points })),
});

describe('fixed mix', () => {
  const a: PricePoint[] = [
    ['2024-03-01', 100],
    ['2024-03-04', 200],
  ];
  const b: PricePoint[] = [
    ['2024-03-01', 50],
    ['2024-03-04', 50],
  ];

  it('splits a deposit by the weights and sells pro rata to current values', () => {
    const v = mix('none', [70, a], [30, b]);
    const r = simulateMix(
      [
        { date: '2024-03-01', amount: 100 },
        { date: '2024-03-04', amount: -85 },
      ],
      v,
      '2024-03-04',
    );
    // 0.7 units of A and 0.6 of B; on 03-04 worth 140 + 30 = 170, half of it is sold.
    expect(r.history[0].units).toEqual([expect.closeTo(0.7, 12), expect.closeTo(0.6, 12)]);
    expect(r.history[1].units).toEqual([expect.closeTo(0.35, 12), expect.closeTo(0.3, 12)]);
    expect(r.value).toBeCloseTo(85, 9);
    expect(r.shortfalls).toEqual([]);
  });

  it('normalises weights that do not sum to 100', () => {
    const r = simulateMix([{ date: '2024-03-01', amount: 100 }], mix('none', [7, a], [3, b]), '2024-03-01');
    expect(r.value).toBeCloseTo(100, 9);
  });

  it('a withdrawal larger than the mix sells everything; the rest is a shortfall', () => {
    const r = simulateMix(
      [
        { date: '2024-03-01', amount: 100 },
        { date: '2024-03-01', amount: 0 },
        { date: '2024-03-04', amount: -300 },
      ].filter((f) => f.amount !== 0),
      mix('none', [70, a], [30, b]),
      '2024-03-04',
    );
    expect(r.executed.at(-1)).toEqual({ date: '2024-03-04', amount: expect.closeTo(-170, 9) });
    expect(r.shortfalls).toEqual([{ date: '2024-03-04', amount: expect.closeTo(130, 9) }]);
    expect(r.value).toBe(0);
  });

  it('rebalances yearly on the first trading day, not before', () => {
    const x: PricePoint[] = [
      ['2023-12-29', 100],
      ['2024-01-02', 200],
      ['2024-01-03', 100],
    ];
    const y: PricePoint[] = [
      ['2023-12-29', 100],
      ['2024-01-02', 100],
      ['2024-01-03', 100],
    ];
    const flows = [{ date: '2023-12-29', amount: 100 }];
    const yearly = simulateMix(flows, mix('yearly', [50, x], [50, y]), '2024-01-03');
    const never = simulateMix(flows, mix('none', [50, x], [50, y]), '2024-01-03');
    const parts = mixParts(mix('yearly', [50, x], [50, y]));
    // No new price yet on New Year's Day: the allocation is unchanged there.
    expect(mixValueOn(parts, yearly.history, '2024-01-01')).toBeCloseTo(100, 9);
    expect(yearly.history.map((h) => h.day)).toEqual(['2023-12-29', '2024-01-02']);
    // On 01-02 worth 150, reset to 75/75: 0.375 units of x and 0.75 of y.
    expect(yearly.history[1].units).toEqual([expect.closeTo(0.375, 12), expect.closeTo(0.75, 12)]);
    expect(yearly.value).toBeCloseTo(112.5, 9);
    expect(never.value).toBeCloseTo(100, 9);
  });

  it('calendar periods start after the period of the first flow', () => {
    expect(periodStarts('2024-02-15', '2024-12-31', 3)).toEqual(['2024-04-01', '2024-07-01', '2024-10-01']);
    expect(periodStarts('2024-11-20', '2025-01-05', 1)).toEqual(['2024-12-01', '2025-01-01']);
    expect(periodStarts('2023-05-02', '2025-01-01', 12)).toEqual(['2024-01-01', '2025-01-01']);
    expect(periodStarts('2024-12-31', '2024-12-31', 1)).toEqual([]);
  });

  it('rebalances monthly and quarterly on the first price day of the period', () => {
    const x: PricePoint[] = [
      ['2024-01-31', 100],
      ['2024-02-01', 200],
      ['2024-03-04', 100],
      ['2024-04-02', 150],
    ];
    const y: PricePoint[] = x.map(([d]) => [d, 100]);
    const flows = [{ date: '2024-01-31', amount: 100 }];
    const days = (r: Rebalance) => simulateMix(flows, mix(r, [50, x], [50, y]), '2024-04-02').history.map((h) => h.day);
    expect(days('monthly')).toEqual(['2024-01-31', '2024-02-01', '2024-03-04', '2024-04-02']);
    expect(days('quarterly')).toEqual(['2024-01-31', '2024-04-02']);
    // A period start more than 10 days before its first price is a price gap, as for the yearly rule.
    const gap: PricePoint[] = x.filter(([d]) => d !== '2024-03-04');
    expect(() => simulateMix(flows, mix('monthly', [50, gap], [50, y]), '2024-04-02')).toThrow('prices_missing');
  });

  it('threshold: rebalances only once a share drifts beyond the band', () => {
    const x: PricePoint[] = [
      ['2024-03-01', 100],
      ['2024-03-04', 110],
      ['2024-03-05', 130],
    ];
    const y: PricePoint[] = [
      ['2024-03-01', 100],
      ['2024-03-04', 100],
      ['2024-03-05', 100],
    ];
    const flows = [{ date: '2024-03-01', amount: 100 }];
    const run = (band?: number) => simulateMix(flows, { ...mix('threshold', [50, x], [50, y]), band }, '2024-03-05');
    // 03-04: x is 55/105 = 52.4 % (2.4 pp off): no trade at the default 5 pp. 03-05: 65/115 = 56.5 %: reset to 57.5/57.5.
    const dflt = run();
    expect(dflt.history.map((h) => h.day)).toEqual(['2024-03-01', '2024-03-05']);
    expect(dflt.history[1].units).toEqual([expect.closeTo(57.5 / 130, 12), expect.closeTo(0.575, 12)]);
    // 2 pp: trades on both days.
    expect(run(2).history.map((h) => h.day)).toEqual(['2024-03-01', '2024-03-04', '2024-03-05']);
    // 50 pp: never trades, so it equals "never".
    expect(run(50).value).toBeCloseTo(simulateMix(flows, mix('none', [50, x], [50, y]), '2024-03-05').value, 12);
  });

  it('threshold: never rebalances while a purchase is pending (only on days every started component trades)', () => {
    // The deposit on 03-03 buys A on 03-04 and B on 03-05 (their next prices). Checking on 03-04 would value B's
    // units, bought at 200, at its 03-01 price of 100.
    const a: PricePoint[] = [
      ['2024-03-01', 100],
      ['2024-03-04', 100],
      ['2024-03-05', 100],
    ];
    const b: PricePoint[] = [
      ['2024-03-01', 100],
      ['2024-03-05', 200],
    ];
    const r = simulateMix([{ date: '2024-03-03', amount: 100 }], mix('threshold', [50, a], [50, b]), '2024-03-05');
    expect(r.value).toBeCloseTo(100, 9);
  });

  it('threshold: a drift of exactly the band does not trade', () => {
    const a: PricePoint[] = [
      ['2024-03-01', 100],
      ['2024-03-04', 110],
      ['2024-03-05', 100],
    ];
    const b: PricePoint[] = [
      ['2024-03-01', 100],
      ['2024-03-04', 90],
      ['2024-03-05', 100],
    ];
    const r = simulateMix([{ date: '2024-03-01', amount: 100 }], mix('threshold', [50, a], [50, b]), '2024-03-05');
    expect(r.history.map((h) => h.day)).toEqual(['2024-03-01']);
    expect(r.value).toBeCloseTo(100, 9);
  });

  it('a component without prices yet keeps its share as cash until its first price', () => {
    const late: PricePoint[] = [
      ['2024-03-10', 25],
      ['2024-03-11', 50],
    ];
    const flat: PricePoint[] = [
      ['2024-03-01', 100],
      ['2024-03-11', 100],
    ];
    const r = simulateMix([{ date: '2024-03-02', amount: 100 }], mix('none', [50, flat], [50, late]), '2024-03-11');
    expect(r.uninvestedUntil).toBe('2024-03-10');
    expect(r.history.map((h) => [h.day, h.cash, h.units])).toEqual([
      ['2024-03-02', [0, 50], [0.5, 0]],
      ['2024-03-10', [0, 0], [0.5, 2]],
    ]);
    expect(r.value).toBeCloseTo(150, 9);
  });

  it('the strategy index starts at the entry; a weekend opening keeps Friday as base', () => {
    const fri: PricePoint[] = [
      ['2024-03-01', 100],
      ['2024-03-04', 80],
      ['2024-03-05', 80],
    ];
    const v = mix('yearly', [50, fri], [50, fri]);
    const idx = mixIndex(v, [{ date: '2024-03-03', amount: 100 }], '2024-03-05', '2024-03-03');
    expect(idx?.[0]).toEqual(['2024-03-03', 1]);
    expect(drawdown(idx)).toEqual({ max: expect.closeTo(-0.2, 12), peak: '2024-03-03', trough: '2024-03-04' });
  });

  it('a component whose prices start after today makes the mix uncomputable', () => {
    expect(() => simulateMix([{ date: '2024-03-01', amount: 100 }], mix('none', [50, a], [50, [['2024-04-01', 1]]]), '2024-03-04')).toThrow(
      'no_prices',
    );
  });
});

describe('mix settings', () => {
  it('reads valid mixes, recomputes the identity independent of order and case, and skips invalid ones', async () => {
    const { parseBenchmarks, mixIdentity } = await import('../src/model/settings');
    const comps = [
      { name: 'World', ticker: 'urth', weight: 70 },
      { name: 'Bonds', ticker: 'AGG', weight: 30 },
    ];
    const r = parseBenchmarks([
      { name: 'A', kind: 'mix', ticker: 'stale', components: comps, rebalance: 'none' },
      { name: 'B', kind: 'mix', components: [comps[1], comps[0]] },
      { name: 'Sum 99', kind: 'mix', components: [{ ticker: 'X', weight: 60 }, { ticker: 'Y', weight: 39 }] },
      { name: 'One', kind: 'mix', components: [{ ticker: 'X', weight: 100 }] },
      { name: 'Twice', kind: 'mix', components: [{ ticker: 'X', weight: 50 }, { ticker: 'x', weight: 50 }] },
      { name: 'Zero', kind: 'mix', components: [{ ticker: 'X', weight: 100 }, { ticker: 'Y', weight: 0 }] },
      { name: 'Three decimals', kind: 'mix', components: [{ ticker: 'X', weight: 70.004 }, { ticker: 'Y', weight: 29.996 }] },
      { name: 'Two decimals', kind: 'mix', components: [{ ticker: 'X', weight: 33.33 }, { ticker: 'Y', weight: 66.67 }] },
    ]);
    expect(r.map((b) => b.name)).toEqual(['A', 'B', 'Two decimals']);
    expect(r[0].ticker).toBe('mix:AGG*30+URTH*70|none');
    expect(r[1].rebalance).toBe('yearly');
    expect(r[1].ticker).toBe(mixIdentity(comps, 'yearly'));
  });

  it('reads every rebalancing rule; the threshold keeps a valid band in its identity, else the default', async () => {
    const { parseBenchmarks } = await import('../src/model/settings');
    const comps = [
      { name: 'World', ticker: 'URTH', weight: 70 },
      { name: 'Bonds', ticker: 'AGG', weight: 30 },
    ];
    const r = parseBenchmarks([
      { name: 'M', kind: 'mix', components: comps, rebalance: 'monthly' },
      { name: 'Q', kind: 'mix', components: comps, rebalance: 'quarterly' },
      { name: 'T', kind: 'mix', components: comps, rebalance: 'threshold', band: 2.5 },
      { name: 'T bad', kind: 'mix', components: comps, rebalance: 'threshold', band: 0.25 },
      { name: 'Unknown', kind: 'mix', components: comps, rebalance: 'daily', band: 3 },
      { name: 'T tiny', kind: 'mix', components: comps, rebalance: 'threshold', band: 0.00000001 },
    ]);
    expect(r.map((b) => [b.rebalance, b.band, b.ticker])).toEqual([
      ['monthly', undefined, 'mix:AGG*30+URTH*70|monthly'],
      ['quarterly', undefined, 'mix:AGG*30+URTH*70|quarterly'],
      ['threshold', 2.5, 'mix:AGG*30+URTH*70|threshold:2.5'],
      ['threshold', 5, 'mix:AGG*30+URTH*70|threshold:5'],
      ['yearly', undefined, 'mix:AGG*30+URTH*70|yearly'],
      ['threshold', 5, 'mix:AGG*30+URTH*70|threshold:5'],
    ]);
  });
});
