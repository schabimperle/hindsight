import { describe, expect, it } from 'vitest';
import { toDay } from '../src/core/dates';
import { netFlows, run, runDetailed } from '../src/core/report';
import { PriceError, Series } from '../src/core/series';
import { isError, type Fixture, type PricePoint, type Report } from '../src/core/types';

/** Daily prices (every calendar day) with a fixed price per section. */
function flat(from: string, to: string, price: number | ((d: string) => number)): PricePoint[] {
  const out: PricePoint[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86400000) {
    const d = new Date(t).toISOString().slice(0, 10);
    out.push([d, typeof price === 'number' ? price : price(d)]);
  }
  return out;
}

const report = (fx: Fixture, i = 0): Report => {
  const r = run(fx).variants[i];
  if (isError(r)) throw new Error(r.error);
  return r;
};

describe('toDay', () => {
  it('converts timestamps into the given time zone, plain dates stay', () => {
    expect(toDay('2024-12-31T23:30:00Z', 'Europe/Berlin')).toBe('2025-01-01');
    expect(toDay('2024-06-30T22:30:00+00:00', 'Europe/Berlin')).toBe('2024-07-01');
    expect(toDay('2025-01-01T23:00:00Z', 'Australia/Sydney')).toBe('2025-01-02');
    expect(toDay('2024-06-30T12:00:00Z')).toBe('2024-06-30');
    expect(toDay('2024-06-30')).toBe('2024-06-30');
    expect(toDay('2024-06-30T12:00:00Z', 'Mars/Olympus')).toBe('2024-06-30');
  });
});

describe('netting per day', () => {
  it('merges the flows of a day and drops zero balances', () => {
    expect(
      netFlows([
        { date: '2024-02-05', amount: -500 },
        { date: '2024-02-05', amount: 500 },
        { date: '2024-02-01', amount: 1000 },
        { date: '2024-02-07', amount: 300 },
        { date: '2024-02-07', amount: -100 },
      ]),
    ).toEqual([
      { date: '2024-02-01', amount: 1000 },
      { date: '2024-02-07', amount: 200 },
    ]);
  });
});

describe('late start', () => {
  it('money stays cash until the first price, a withdrawal before it reduces it, then everything is bought at once', () => {
    const fx: Fixture = {
      today: '2024-06-30',
      flows: [
        { date: '2024-01-10', amount: 1000 },
        { date: '2024-02-10', amount: -400 },
        { date: '2024-04-10', amount: 500 },
      ],
      variants: [{ name: 'X', kind: 'asset', points: flat('2024-03-01', '2024-06-30', (d) => (d < '2024-06-01' ? 10 : 20)) }],
    };
    const r = report(fx);
    // 600 cash on 1 Mar -> 60 units, 500 on 10 Apr -> 50 units; today 110 x 20
    expect(r.value).toBeCloseTo(2200, 9);
    expect(r.invested).toBeCloseTo(1100, 9);
    expect(r.gain).toBeCloseTo(1100, 9);
    expect(r.uninvestedUntil).toBe('2024-03-01');
    expect(r.warnings).toEqual(['late_start']);
    const path = runDetailed(fx).paths[0];
    expect(path.find((p) => p.date === '2024-01-31')?.value).toBe(1000);
    expect(path.find((p) => p.date === '2024-02-29')?.value).toBe(600);
    expect(path.find((p) => p.date === '2024-03-31')?.value).toBeCloseTo(600, 9);
  });

  it('first price after today or no prices: error', () => {
    const base: Omit<Fixture, 'variants'> = { today: '2024-06-30', flows: [{ date: '2024-01-10', amount: 1000 }] };
    expect(run({ ...base, variants: [{ name: 'A', kind: 'asset', points: [['2024-07-01', 1]] }] }).variants[0]).toEqual({ name: 'A', error: 'no_prices' });
    expect(run({ ...base, variants: [{ name: 'B', kind: 'asset', points: [] }] }).variants[0]).toEqual({ name: 'B', error: 'no_prices' });
  });
});

describe('uncovered withdrawal', () => {
  it('sells everything, counts only the covered part in gain and XIRR', () => {
    const fx: Fixture = {
      today: '2025-01-01',
      flows: [
        { date: '2024-01-01', amount: 1000 },
        { date: '2024-07-01', amount: -800 },
        { date: '2024-10-01', amount: 300 },
      ],
      variants: [{ name: 'X', kind: 'asset', points: flat('2023-12-01', '2025-01-01', (d) => (d < '2024-06-01' ? 10 : d < '2024-09-01' ? 5 : 6)) }],
    };
    const r = report(fx);
    // 100 units; on 1 Jul value 500 -> 500 covered, 300 uncovered; 300 buys 50 units at 6
    expect(r.shortfall).toBeCloseTo(300, 9);
    expect(r.shortfalls).toEqual([{ date: '2024-07-01', amount: expect.closeTo(300, 9) as unknown as number }]);
    expect(r.invested).toBeCloseTo(800, 9);
    expect(r.value).toBeCloseTo(300, 9);
    expect(r.gain).toBeCloseTo(-500, 9);
    expect(r.warnings).toEqual(['withdrawal_uncovered']);
    expect(r.irr).not.toBeNull();
  });

  it('also applies to cash before the start and to “Not invested”', () => {
    const fx: Fixture = {
      today: '2024-06-30',
      flows: [
        { date: '2024-01-10', amount: 100 },
        { date: '2024-01-20', amount: -150 },
      ],
      variants: [
        { name: 'Late', kind: 'asset', points: flat('2024-03-01', '2024-06-30', 1) },
        { name: 'Cash', kind: 'cash', points: [] },
      ],
    };
    for (const i of [0, 1]) {
      const r = report(fx, i);
      expect(r.shortfalls).toEqual([{ date: '2024-01-20', amount: 50 }]);
      expect(r.value).toBe(0);
      expect(r.invested).toBe(0);
    }
  });
});

describe('deposits and withdrawals', () => {
  it('split the executed net flow; an uncovered withdrawal only counts as far as it was covered', () => {
    const fx: Fixture = {
      today: '2024-06-30',
      flows: [
        { date: '2024-01-10', amount: 100 },
        { date: '2024-02-10', amount: 50 },
        { date: '2024-03-10', amount: -30 },
        { date: '2024-04-10', amount: -400 },
      ],
      variants: [{ name: 'Cash', kind: 'cash', points: [] }],
      actual: { value: 130 },
    };
    const out = run(fx);
    const actual = out.actual as Report;
    expect(actual.deposits).toBe(150);
    expect(actual.withdrawals).toBe(430);
    expect(actual.invested).toBe(-280);
    const cash = out.variants[0] as Report;
    expect(cash.deposits).toBe(150);
    expect(cash.withdrawals).toBe(150); // 30 + the 120 left of the 400
    expect(cash.invested).toBe(0);
  });
});

describe('inflation', () => {
  it('without CPI no real figures; CPI not covering the first flow -> cpiError', () => {
    const base: Fixture = {
      today: '2024-06-30',
      flows: [{ date: '2024-01-10', amount: 1000 }],
      variants: [{ name: 'Cash', kind: 'cash', points: [] }],
      actual: { value: 1100 },
    };
    const none = run(base);
    expect(none.investedReal).toBeNull();
    expect(none.cpiError).toBeNull();
    expect((none.actual as Report).gainReal).toBeNull();
    const late = run({ ...base, cpi: { '2024-03': 100 } });
    expect(late.cpiError).toBe('inflation_missing');
    expect(late.investedReal).toBeNull();
    const ok = run({ ...base, cpi: { '2024-01': 100, '2024-05': 110 } });
    expect(ok.investedReal).toBeCloseTo(1100, 9);
    expect((ok.actual as Report).gainReal).toBeCloseTo(0, 9);
    expect(ok.cpiFilled).toEqual([]);
    expect(run({ ...base, cpi: {} }).cpiError).toBeNull();
  });

  it('gap inside the series: value of the last month before it, reported only if a flow falls into it', () => {
    const base: Fixture = {
      today: '2026-01-20',
      flows: [
        { date: '2025-08-10', amount: 1000 },
        { date: '2025-10-05', amount: 1000 },
        { date: '2025-11-05', amount: 1000 },
        { date: '2026-01-05', amount: 1000 },
      ],
      variants: [{ name: 'Cash', kind: 'cash', points: [] }],
      actual: { value: 4000 },
      // USA: 2025-10 and 2025-11 are missing, 2025-12 is the last month
      cpi: { '2025-08': 100, '2025-09': 101, '2025-12': 110 },
    };
    const r = run(base);
    expect(r.cpiError).toBeNull();
    expect(r.cpiFilled).toEqual(['2025-10', '2025-11']);
    expect(r.investedReal).toBeCloseTo(1000 * (1.1 + 1.1 / 1.01 + 1.1 / 1.01 + 1), 9);
    const noFlowInGap = run({ ...base, flows: [base.flows[0], base.flows[3]] });
    expect(noFlowInGap.cpiFilled).toEqual([]);
  });
});

describe('price for a flow', () => {
  // Friday 2024-06-28 is the last price
  const s = new Series([
    ['2024-06-27', 10],
    ['2024-06-28', 11],
  ]);
  it('on the day or after; without a later price the last one, if at most 10 days old', () => {
    expect(s.tradePrice('2024-06-27')).toBe(10);
    expect(s.tradePrice('2024-06-20')).toBe(10);
    expect(s.tradePrice('2024-06-29')).toBe(11);
    expect(s.tradePrice('2024-07-08')).toBe(11);
    expect(() => s.tradePrice('2024-07-09')).toThrow(PriceError);
    expect(() => s.tradePrice('2024-06-16')).toThrow(PriceError);
  });
  it('Saturday = today: a deposit buys at Friday\'s price instead of prices_missing', () => {
    const r = report({
      today: '2024-06-29',
      flows: [
        { date: '2024-06-27', amount: 100 },
        { date: '2024-06-29', amount: 110 },
      ],
      variants: [{ name: 'A', kind: 'asset', points: [['2024-06-27', 10], ['2024-06-28', 11]] }],
    });
    // 10 units at 10, then 10 units at Friday's price 11; value 20 x 11
    expect(r.value).toBeCloseTo(220, 9);
    expect(r.invested).toBe(210);
  });
  it('nearestWithin: closest price (before or after, at most 10 days), tie: before', () => {
    expect(s.nearestWithin('2024-06-17')).toBe(10);
    expect(s.nearestWithin('2024-06-16')).toBeNull();
    expect(s.nearestWithin('2024-06-29')).toBe(11);
    expect(s.nearestWithin('2024-07-08')).toBe(11);
    expect(s.nearestWithin('2024-07-09')).toBeNull();
    const gap = new Series([['2024-06-01', 1], ['2024-06-11', 2]]);
    expect(gap.nearestWithin('2024-06-09')).toBe(2);
    expect(gap.nearestWithin('2024-06-06')).toBe(1);
  });
});
