import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isError, type Fixture, type Report, type RunOutput } from '../src/core/types';
import { analyze, type AnalysisInput } from '../src/model/analysis';
import type { RealPortfolio } from '../src/sources/portfolio';

const read = <T>(n: string): T => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8')) as T;
const fx = read<Fixture>('synthetic.json');
const want = read<RunOutput>('synthetic.expected.json');

function input(overrides: Partial<AnalysisInput> = {}, real: Partial<RealPortfolio> = {}): AnalysisInput {
  const cpi = fx.cpi as Record<string, number>;
  return {
    flows: fx.flows,
    flowWarnings: [],
    unvalued: [],
    unconverted: [],
    country: 'DEU',
    cpi: { country: 'DEU', cpi, lastMonth: Object.keys(cpi).sort().at(-1) as string, staleHours: null },
    cpiError: null,
    fxStaleHours: null,
    benchmarks: fx.variants.map((v) => ({
      def: { name: v.name, ticker: v.kind === 'cash' ? '' : v.name, kind: v.kind },
      points: v.kind === 'cash' ? null : v.points,
      currency: 'EUR',
      firstDay: v.points[0]?.[0] ?? null,
      error: null,
      staleHours: null,
    })),
    real: {
      baseCurrency: 'EUR',
      timeZone: 'Europe/Berlin',
      accountIds: ['A'],
      asOf: fx.today,
      value: fx.actual!.value,
      netContribution: fx.flows.reduce((s, f) => s + f.amount, 0),
      activities: [],
      heldValue: {},
      quotes: {},
      quoteCurrencies: {},
      daily: [],
      valuationDays: [],
      historyMissing: false,
      ...real,
    },
    ...overrides,
  };
}

describe('analyze', () => {
  it('reproduces the oracle values for variants and the real portfolio', () => {
    const a = analyze(input());
    expect(a.fatal).toBeNull();
    expect(a.rows[0].kind).toBe('actual');
    expect(a.rows).toHaveLength(want.variants.length + 1);
    const real = a.rows[0].result as Report;
    const wantActual = want.actual as Report;
    expect(real.gain).toBeCloseTo(wantActual.gain, 2);
    expect(real.gainReal).toBeCloseTo(wantActual.gainReal as number, 2);
    want.variants.forEach((w, i) => {
      const r = a.rows[i + 1].result;
      expect(isError(r)).toBe(isError(w));
      if (!isError(r) && !isError(w)) {
        expect(r.value).toBeCloseTo(w.value, 2);
        expect(r.gain).toBeCloseTo(w.gain, 2);
      }
    });
    expect(a.depositCount + a.withdrawalCount).toBe(fx.flows.length);
    // Every booking lands on exactly one chart point, so the markers add up to the counts in the metric cards.
    const marked = (key: string): number => a.chart.reduce((s, p) => s + ((p[key] as number | undefined) ?? 0), 0);
    expect(marked('depCount')).toBe(a.depositCount);
    expect(marked('wdCount')).toBe(a.withdrawalCount);
    expect(a.investedNominal).toBeCloseTo(want.investedNominal, 6);
    expect(a.chart.length).toBeGreaterThan(80);
    expect(a.chart[a.chart.length - 1].date).toBe(fx.today);
    expect(a.chart[a.chart.length - 1].net).toBeCloseTo(a.investedNominal, 6);
  });

  it('keeps markers on actual booking days, including same-day flows netting to zero', () => {
    const base = input();
    const day = '2024-03-12';
    const flows = [...base.flows, { date: day, amount: 100 }, { date: day, amount: -100 }, { date: day, amount: 0 }];
    const a = analyze({ ...base, flows });
    const point = a.chart.find((p) => p.date === day);
    expect(point).toMatchObject({ depCount: 1, wdCount: 1, depAmount: 100, wdAmount: 100 });
    for (const flow of flows.filter((f) => f.amount !== 0)) {
      const p = a.chart.find((p) => p.date === flow.date);
      expect(p?.[flow.amount > 0 ? 'depCount' : 'wdCount']).toBeGreaterThan(0);
    }
    const cash = a.rows.find((r) => r.variantKind === 'cash');
    expect(cash).toBeDefined();
    expect(typeof point?.[cash!.key]).toBe('number');
  });

  it('variant warnings carry amount and date', () => {
    const a = analyze(input());
    const loss = a.rows.find((r) => r.name === 'Total loss');
    expect(loss?.warnings[0]).toMatchObject({ code: 'withdrawal_uncovered', params: { date: { date: '2023-07-15' }, count: 1 } });
    const late = a.rows.find((r) => r.name === 'Late start');
    expect(late?.warnings).toEqual([{ code: 'late_start', params: { date: { date: '2021-01-04' } } }]);
  });

  it('data-layer errors become row errors', () => {
    const base = input();
    const benchmarks = base.benchmarks.map((b, i) => (i === 0 ? { ...b, points: null, error: 'fx_rate_missing' } : b));
    const a = analyze({ ...base, benchmarks });
    expect(a.rows[1].result).toEqual({ name: 'Rising', error: 'fx_rate_missing' });
    expect(isError(a.rows[2].result)).toBe(false);
  });

  it('without a country: no real figures, no blocking', () => {
    const a = analyze(input({ cpi: null, country: null }));
    expect(a.fatal).toBeNull();
    expect(a.investedReal).toBeNull();
    expect((a.rows[0].result as Report).gainReal).toBeNull();
  });

  it('header warnings: cross-check, lagging inflation, inflation load error', () => {
    expect(analyze(input({}, { netContribution: 12345 })).headerWarnings.map((w) => w.code)).toContain('net_contribution_mismatch');
    const base = input();
    const lagged = analyze({ ...base, cpi: { ...base.cpi!, lastMonth: '2026-01' } });
    expect(lagged.headerWarnings).toContainEqual({ code: 'inflation_stale', params: { month: { month: '2026-01' } } });
    expect(analyze(input()).headerWarnings.map((w) => w.code)).not.toContain('inflation_stale');
    const failed = analyze(input({ cpi: null, cpiError: 'inflation_unavailable' }));
    expect(failed.fatal).toBeNull();
    expect(failed.headerWarnings.map((w) => w.code)).toContain('inflation_unavailable');
  });

  it('blocking: no accounts, no deposits, asset transfer without value (with list)', () => {
    expect(analyze(input({}, { accountIds: [] })).fatal?.code).toBe('no_accounts');
    expect(analyze(input({ flows: [] })).fatal?.code).toBe('no_deposits');
    const items = [{ date: '2024-03-05', symbol: 'EUNL', account: 'Brokerage' }];
    expect(analyze(input({ unvalued: items })).fatal).toEqual({ code: 'asset_transfer_unvalued', items });
    const fxItems = [{ date: '2024-03-05', symbol: 'CHF', account: 'Account' }];
    expect(analyze(input({ unconverted: fxItems })).fatal).toEqual({
      code: 'foreign_currency_no_rate',
      params: { currency: 'EUR' },
      items: fxItems,
    });
    const both = analyze(input({ unvalued: items, unconverted: fxItems }));
    expect(both.fatal?.code).toBe('asset_transfer_unvalued');
    expect(both.moreFatal.map((w) => w.code)).toEqual(['foreign_currency_no_rate']);
  });

  it('inflation: gap inside the series as a warning with months, series starting too late with country and month', () => {
    const a = analyze(input());
    expect(a.headerWarnings).toContainEqual({ code: 'inflation_gap', params: { months: { months: ['2025-10', '2025-11'] }, count: 2 } });
    expect(a.investedReal).toBeCloseTo(want.investedReal as number, 2);
    const base = input();
    const cpi = Object.fromEntries(Object.entries(base.cpi!.cpi).filter(([m]) => m >= '2024-04'));
    const late = analyze({ ...base, country: 'AUS', cpi: { ...base.cpi!, country: 'AUS', cpi } });
    expect(late.investedReal).toBeNull();
    expect(late.headerWarnings).toContainEqual({
      code: 'inflation_missing',
      params: { country: { country: 'AUS' }, month: { month: '2024-04' }, date: { date: '2019-01-03' } },
    });
  });

  it('any base currency', () => {
    const a = analyze(input({}, { baseCurrency: 'JPY' }));
    expect(a.fatal).toBeNull();
    expect(a.baseCurrency).toBe('JPY');
  });
});

describe('analyze over a window', () => {
  const wfx = read<Fixture>('synthetic-window.json');
  const wwant = read<RunOutput>('synthetic-window.expected.json');
  const asOf = '2026-06-15';
  const daily = [
    { date: '2023-03-10', value: 83456.78 },
    { date: '2025-12-29', value: 97000 },
    { date: asOf, value: 101234.56 },
  ];
  const winput = (real: Partial<RealPortfolio> = {}): AnalysisInput => {
    const base = input({}, { asOf, value: 101234.56, daily, ...real });
    return {
      ...base,
      flows: wfx.flows,
      benchmarks: wfx.variants.map((v) => ({
        def: { name: v.name, ticker: v.kind === 'cash' ? '' : v.name, kind: v.kind },
        points: v.kind === 'cash' ? null : v.points,
        currency: 'EUR',
        firstDay: v.points[0]?.[0] ?? null,
        error: null,
        staleHours: null,
      })),
    };
  };
  const win = { from: '2023-03-15', to: '2025-12-31' };

  it('opening value from the valuation on or before the start, value at a custom end: equals the oracle', () => {
    const a = analyze(winput(), win);
    expect(a.fatal).toBeNull();
    expect(a.today).toBe('2025-12-31');
    expect(a.openingValue).toBeCloseTo(83456.78, 6);
    expect(a.start).toBe('2023-03-15');
    expect(a.firstEver).toBe('2019-01-03');
    expect(a.investedNominal).toBeCloseTo(wwant.investedNominal, 6);
    const actual = a.rows[0].result as Report;
    expect(actual.gain).toBeCloseTo((wwant.actual as Report).gain, 2);
    wwant.variants.forEach((w, i) => {
      const r = a.rows[i + 1].result;
      if (!isError(r) && !isError(w)) {
        expect(r.value).toBeCloseTo(w.value, 2);
        expect(r.irr as number).toBeCloseTo(w.irr as number, 6);
      }
    });
    // weekly chart points over ~2.8 years, first point = opening value
    expect(a.chart[0].date).toBe('2023-03-15');
    expect(a.chart[0].net).toBeCloseTo(83456.78, 6);
    expect(a.chart[0].actual).toBeCloseTo(83456.78, 6);
    expect(a.chart.at(-1)?.date).toBe('2025-12-31');
  });

  it('a start on or before the first flow is all time', () => {
    const a = analyze(winput(), { from: '2010-01-01', to: null });
    expect(a.openingValue).toBeNull();
    expect(a.start).toBe('2019-01-03');
  });

  it('missing or stale valuations block instead of counting as zero', () => {
    expect(analyze(winput({ daily: [{ date: asOf, value: 1 }] }), win).fatal).toEqual({
      code: 'valuation_missing',
      params: { date: { date: '2023-03-15' } },
    });
    const stale = [{ date: '2023-02-01', value: 80000 }, ...daily.slice(1)];
    expect(analyze(winput({ daily: stale }), win).fatal?.code).toBe('valuation_missing');
    const noEnd = [daily[0], { date: asOf, value: 101234.56 }];
    expect(analyze(winput({ daily: noEnd }), win).fatal).toEqual({ code: 'valuation_missing', params: { date: { date: '2025-12-31' } } });
  });

  it('one stale or missing account history blocks, even if the total looks fine', () => {
    const fresh = [['2023-03-10', '2025-12-29'], ['2023-03-14', '2025-12-30']];
    expect(analyze(winput({ valuationDays: fresh }), win).fatal).toBeNull();
    const stale = [['2023-03-10', '2025-12-29'], ['2022-11-01', '2025-12-30']];
    expect(analyze(winput({ valuationDays: stale }), win).fatal).toEqual({ code: 'valuation_missing', params: { date: { date: '2023-03-15' } } });
    const later = [['2023-03-10', '2025-12-29'], ['2024-05-01', '2025-12-30']];
    expect(analyze(winput({ valuationDays: later }), win).fatal).toBeNull();
    expect(analyze(winput({ historyMissing: true }), win).fatal?.code).toBe('valuation_missing');
    expect(analyze(winput({ historyMissing: true }), { from: null, to: null }).fatal).toBeNull();
  });

  it('a period before the first deposit says so', () => {
    expect(analyze(winput(), { from: '2010-01-01', to: '2015-01-01' }).fatal).toEqual({ code: 'no_deposits_window' });
  });

  it('a start after the window end is an empty window', () => {
    expect(analyze(winput(), { from: '2026-07-01', to: null }).fatal).toEqual({ code: 'window_empty' });
  });

  it('under a year: money-weighted returns over the window', () => {
    const a = analyze(winput(), { from: '2025-12-31', to: null });
    expect(a.fatal).toBeNull();
    expect(a.mwrPeriodDays).toBe(166);
    expect(analyze(winput(), win).mwrPeriodDays).toBeNull();
  });
});

const fxDaily = (fx.actual?.daily ?? []).map(([date, value]) => ({ date, value }));

describe('drawdown', () => {
  it('the real portfolio drawdown comes from its covered daily valuations and matches the oracle', () => {
    const a = analyze(input({}, { daily: fxDaily }));
    const actual = a.rows.find((r) => r.kind === 'actual')?.result as Report;
    expect(want.actual && 'drawdown' in want.actual ? want.actual.drawdown : undefined).toBeTruthy();
    expect(actual.drawdown?.max).toBeCloseTo((want.actual as Report).drawdown?.max as number, 9);
    expect(actual.drawdown?.recovery).toBe((want.actual as Report).drawdown?.recovery);
  });

  it('days on which a started account has no valuation of its own do not count; a booking on one blocks it', () => {
    const days = fxDaily.map((p) => p.date);
    // Account B starts mid-way and misses one day: the total of that day carries B's older state forward.
    const b = days.filter((d) => d >= '2022-01-01' && d !== '2023-07-15');
    const a = analyze(input({}, { daily: fxDaily, valuationDays: [days, b] }));
    // 2023-07-15 has a withdrawal, so the real portfolio's drawdown is unavailable.
    expect((a.rows.find((r) => r.kind === 'actual')?.result as Report).drawdown).toBeNull();
    const ok = analyze(input({}, { daily: fxDaily, valuationDays: [days, days.filter((d) => d !== '2022-02-02')] }));
    expect((ok.rows.find((r) => r.kind === 'actual')?.result as Report).drawdown).not.toBeNull();
  });

  it('a custom end or an opening day without full coverage gives no drawdown', () => {
    const days = fxDaily.map((p) => p.date);
    const actualDd = (a: ReturnType<typeof analyze>): unknown => (a.rows.find((r) => r.kind === 'actual')?.result as Report).drawdown;
    const gapAt = (day: string) => ({ daily: fxDaily, valuationDays: [days, days.filter((d) => d !== day)] });
    expect(actualDd(analyze(input({}, { daily: fxDaily, valuationDays: [days, days] }), { from: null, to: '2025-12-31' }))).not.toBeNull();
    expect(actualDd(analyze(input({}, gapAt('2025-12-31')), { from: null, to: '2025-12-31' }))).toBeNull();
    expect(actualDd(analyze(input({}, { daily: fxDaily, valuationDays: [days, days] }), { from: '2023-03-15', to: null }))).not.toBeNull();
    expect(actualDd(analyze(input({}, gapAt('2023-03-15')), { from: '2023-03-15', to: null }))).toBeNull();
  });

  it('every alternative has its drawdown; uncomputable ones have none', () => {
    const a = analyze(input());
    for (const row of a.rows) {
      if (row.kind === 'actual') continue;
      if (isError(row.result)) continue;
      const w = want.variants.find((v) => v.name === row.name) as Report;
      expect(row.result.drawdown, row.name).toEqual(w.drawdown);
    }
  });
});

describe('gain chart', () => {
  const cumNaive = (day: string): number => fx.flows.filter((f) => f.date <= day).reduce((s, f) => s + f.amount, 0);

  it('has the same days and booking counts, a zero reference, and ends at every report gain', () => {
    const a = analyze(input());
    expect(a.gainChart).toHaveLength(a.chart.length);
    a.gainChart.forEach((p, i) => {
      expect(p.date).toBe(a.chart[i].date);
      expect(p.depCount).toBe(a.chart[i].depCount);
      expect(p.wdCount).toBe(a.chart[i].wdCount);
      expect(p.net).toBe(0);
    });
    const last = a.gainChart.at(-1) as Record<string, number | string | null>;
    for (const row of a.rows) {
      if (!isError(row.result)) expect(last[row.key], row.name).toBeCloseTo(row.result.gain, 6);
      else expect(last[row.key]).toBeNull();
    }
  });

  it('subtracts the alternative\'s own executed flows, before and after a partly uncovered withdrawal', () => {
    const a = analyze(input());
    const loss = a.rows.find((r) => r.name === 'Total loss') as (typeof a.rows)[number];
    const rep = loss.result as Report;
    expect(rep.shortfalls).toHaveLength(1);
    const miss = rep.shortfalls[0];
    expect(miss.amount).toBeGreaterThan(1);
    let before = 0;
    let after = 0;
    a.chart.forEach((p, i) => {
      const v = p[loss.key];
      if (typeof v !== 'number') return;
      const day = p.date as string;
      // The uncovered part never left the alternative, so only from the withdrawal on it differs from the real flows.
      const executed = cumNaive(day) + (day >= miss.date ? miss.amount : 0);
      expect(a.gainChart[i][loss.key], day).toBeCloseTo(v - executed, 6);
      if (day >= miss.date) {
        after++;
        expect(v - executed).not.toBeCloseTo(v - cumNaive(day), 0);
      } else before++;
    });
    expect(before).toBeGreaterThan(5);
    expect(after).toBeGreaterThan(5);
  });

  it('difference chart: the real portfolio is the zero line, every line ends at its nominal gain difference', () => {
    // With the fixture's daily valuations, so the real portfolio's gain (and the subtraction) exists on past days too.
    const a = analyze(input({}, { daily: fxDaily }));
    expect(a.diffChart.filter((p) => typeof p.actual === 'number').length).toBeGreaterThan(50);
    expect(a.diffChart).toHaveLength(a.chart.length);
    const actual = a.rows.find((r) => r.kind === 'actual') as (typeof a.rows)[number];
    const actualGain = (actual.result as Report).gain;
    a.diffChart.forEach((p, i) => {
      const g = a.gainChart[i];
      expect(p.date).toBe(g.date);
      expect(p.depCount).toBe(g.depCount);
      expect(p.wdCount).toBe(g.wdCount);
      expect(p.net).toBe(0);
      for (const row of a.rows) {
        const v = g[row.key];
        const base = g.actual;
        if (typeof v === 'number' && typeof base === 'number') expect(p[row.key], row.name).toBeCloseTo(v - base, 6);
        else expect(p[row.key], row.name).toBeNull();
      }
    });
    const last = a.diffChart.at(-1) as Record<string, number | string | null>;
    expect(last.actual).toBe(0);
    for (const row of a.rows) {
      if (row.kind === 'actual') continue;
      if (isError(row.result)) expect(last[row.key]).toBeNull();
      // Includes the uncovered withdrawal of "Total loss": the end point is the gain difference, not the value one.
      else expect(last[row.key], row.name).toBeCloseTo(row.result.gain - actualGain, 6);
    }
  });

  it('starts a period at zero gain for every line', () => {
    const wfx = read<Fixture>('synthetic-window.json');
    const daily = [
      { date: '2023-03-10', value: 83456.78 },
      { date: '2025-12-29', value: 97000 },
      { date: '2026-06-15', value: 101234.56 },
    ];
    const base = input({}, { asOf: '2026-06-15', value: 101234.56, daily });
    const a = analyze(
      {
        ...base,
        flows: wfx.flows,
        benchmarks: wfx.variants.map((v) => ({
          def: { name: v.name, ticker: v.kind === 'cash' ? '' : v.name, kind: v.kind },
          points: v.kind === 'cash' ? null : v.points,
          currency: 'EUR',
          firstDay: v.points[0]?.[0] ?? null,
          error: null,
          staleHours: null,
        })),
      },
      { from: '2023-03-15', to: '2025-12-31' },
    );
    expect(a.fatal).toBeNull();
    const first = a.gainChart[0];
    expect(first.date).toBe('2023-03-15');
    const keys = a.rows.filter((r) => !isError(r.result)).map((r) => r.key);
    expect(keys.length).toBeGreaterThan(2);
    for (const k of keys) expect(first[k], k).toBeCloseTo(0, 6);
    const last = a.gainChart.at(-1) as Record<string, number | string | null>;
    for (const row of a.rows) if (!isError(row.result)) expect(last[row.key], row.name).toBeCloseTo(row.result.gain, 6);
  });
});
