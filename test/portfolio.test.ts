import type { Account, AccountValuation, Holding, Quote } from '@wealthfolio/addon-sdk';
import { describe, expect, it } from 'vitest';
import { defaultAccountIds, fetchAllActivities, loadRealPortfolio, mapLimit, dailyTotals, totalsOn, valueOn, type PortfolioApi } from '../src/sources/portfolio';
import type { FetchDeps } from '../src/sources/http';
import { loadAll } from '../src/sources/load';

const acc = (id: string, o: Partial<Account> = {}) => ({ id, accountType: 'SECURITIES', isActive: true, isArchived: false, ...o }) as Account;

describe('accounts', () => {
  it('default selection: active, not archived, not CASH', () => {
    const ids = defaultAccountIds([
      acc('a'),
      acc('b', { accountType: 'CASH' }),
      acc('c', { isArchived: true }),
      acc('d', { isActive: false }),
      acc('e', { accountType: 'CRYPTOCURRENCY' }),
    ]);
    expect(ids).toEqual(['a', 'e']);
  });
});

describe('mapLimit', () => {
  it('limits concurrency and preserves order', async () => {
    let running = 0;
    let max = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6, 7, 8, 9], 4, async (n) => {
      running++;
      max = Math.max(max, running);
      await new Promise((r) => setTimeout(r, 2));
      running--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18]);
    expect(max).toBeLessThanOrEqual(4);
  });
});

function fakeApi(pageBase: 0 | 1): PortfolioApi & { calls: number[] } {
  const rows = Array.from({ length: 7 }, (_, i) => ({ id: `r${i}`, accountId: 'A', activityType: 'DEPOSIT', date: '2024-01-01T00:00:00+00:00' }));
  const calls: number[] = [];
  return {
    calls,
    accounts: { getAll: async () => [acc('A')] },
    settings: { get: async () => ({ baseCurrency: 'EUR' }) },
    portfolio: {
      getHoldings: async () => [],
      getLatestValuations: async () => [],
      getHistoricalValuations: async () => [],
    },
    activities: {
      search: async (page, size) => {
        calls.push(page);
        const i = (page - pageBase) * size;
        const data = page < pageBase ? [] : rows.slice(i, i + size);
        return { data: data as never, meta: { totalRowCount: rows.length } };
      },
    },
    quotes: { getHistory: async () => [] },
  };
}

describe('fetchAllActivities', () => {
  it.each([0, 1] as const)('page numbering from %i', async (base) => {
    const api = fakeApi(base);
    const rows = await fetchAllActivities(api, ['A']);
    expect(rows).toHaveLength(7);
  });
});

describe('loadRealPortfolio', () => {
  it('sums today\'s values per asset, loads prices only for transferred assets, time zone from the settings', async () => {
    const holding = (assetId: string, base: number, o: Record<string, unknown> = {}) =>
      ({
        holdingType: 'security',
        accountId: 'A',
        quantity: 10,
        localCurrency: 'EUR',
        marketValue: { local: base, base },
        instrument: { id: assetId, symbol: assetId.toUpperCase() },
        ...o,
      }) as unknown as Holding;
    const api = fakeApi(0);
    api.settings.get = async () => ({ baseCurrency: 'USD', timezone: 'Europe/Berlin' });
    api.activities.search = async () => ({
      data: [
        { id: 't1', accountId: 'A', activityType: 'TRANSFER_IN', assetId: 'btc', quantity: '1', date: '2024-01-01T23:30:00Z' },
        { id: 't2', accountId: 'A', activityType: 'BUY', assetId: 'fund1', quantity: '1', date: '2024-01-01' },
      ] as never,
      meta: { totalRowCount: 2 },
    });
    api.portfolio.getHoldings = async () => [holding('fund1', 1000), holding('fund1', 500), { holdingType: 'cash', accountId: 'A', quantity: 5 } as unknown as Holding];
    api.portfolio.getLatestValuations = async () =>
      [{ totalValueBase: 1500, netContributionBase: 900, valuationDate: '2026-06-12' }] as unknown as AccountValuation[];
    const asked: string[] = [];
    api.quotes.getHistory = async (id) => {
      asked.push(id);
      return [{ timestamp: '2024-01-01T23:00:00Z', close: 50, currency: 'GBp' }] as unknown as Quote[];
    };
    const r = await loadRealPortfolio(api, null);
    expect(r.baseCurrency).toBe('USD');
    expect(r.timeZone).toBe('Europe/Berlin');
    expect(r.heldValue).toEqual({ fund1: 1500 });
    expect(asked).toEqual(['btc']);
    expect(r.quotes.btc).toEqual([['2024-01-02', 50]]);
    expect(r.quoteCurrencies.btc).toBe('GBp');
    expect(r.value).toBe(1500);
    expect(r.asOf).toBe('2026-06-12');
  });

  it('no further queries without accounts', async () => {
    const api = fakeApi(0);
    const r = await loadRealPortfolio(api, []);
    expect(r.accountIds).toEqual([]);
    expect(api.calls).toEqual([]);
  });
});

describe('loadAll: asset transfer with Wealthfolio price', () => {
  it('takes the closest price to the booking day (before or after, at most 10 days)', async () => {
    const api = fakeApi(0);
    api.settings.get = async () => ({ baseCurrency: 'EUR', timezone: 'Europe/Berlin' });
    api.activities.search = async () => ({
      data: [
        { id: 't1', accountId: 'A', activityType: 'TRANSFER_IN', assetId: 'btc', assetSymbol: 'BTC', quantity: '2', date: '2024-01-01T10:00:00Z' },
        { id: 't2', accountId: 'A', activityType: 'TRANSFER_IN', assetId: 'eth', assetSymbol: 'ETH', quantity: '1', date: '2024-01-01T10:00:00Z' },
        { id: 't3', accountId: 'A', activityType: 'TRANSFER_IN', assetId: 'sol', assetSymbol: 'SOL', quantity: '1', date: '2024-01-20T10:00:00Z' },
      ] as never,
      meta: { totalRowCount: 3 },
    });
    api.portfolio.getLatestValuations = async () =>
      [{ totalValueBase: 1, netContributionBase: 0, valuationDate: '2024-02-01' }] as unknown as AccountValuation[];
    const quotes: Record<string, [string, number][]> = {
      btc: [['2024-01-05', 40000]], // 4 days after the booking
      eth: [['2024-01-12', 2000]], // 11 days after: too far
      sol: [['2024-01-15', 90], ['2024-01-22', 100]], // 2 days after is closer than 5 days before
    };
    api.quotes.getHistory = async (id) =>
      (quotes[id] ?? []).map(([d, close]) => ({ timestamp: `${d}T12:00:00Z`, close, currency: 'EUR' })) as unknown as Quote[];
    const store = new Map<string, string>();
    const deps: FetchDeps = {
      net: {
        request: async () => {
          throw new Error('offline');
        },
      },
      storage: { get: async (k) => store.get(k) ?? null, set: async (k, v) => void store.set(k, v) },
      nowMs: () => Date.parse('2024-02-01T12:00:00Z'),
    };
    const r = await loadAll(api, deps, { accounts: null, benchmarks: [] });
    expect(r.flows.flows).toEqual([
      { date: '2024-01-01', amount: 80000 },
      { date: '2024-01-20', amount: 100 },
    ]);
    expect(r.flows.unvalued).toEqual([{ date: '2024-01-01', symbol: 'ETH', account: 'A' }]);
  });
});

describe('fetchAllActivities with clamped page 0', () => {
  it('reads all pages, even if page 0 = page 1', async () => {
    const all = Array.from({ length: 1200 }, (_, i) => ({ id: `a${i}` }));
    const api = {
      activities: {
        // 1-based; page 0 is clamped to page 1
        search: async (page: number, size: number) => {
          const p = Math.max(page, 1);
          return { data: all.slice((p - 1) * size, p * size), meta: { totalRowCount: all.length } };
        },
      },
    } as unknown as PortfolioApi;
    const rows = await fetchAllActivities(api, ['A']);
    expect(rows).toHaveLength(1200);
  });
});

describe('totalsOn / dailyTotals / valueOn', () => {
  const v = (d: string, x: number) => ({ valuationDate: d, totalValueBase: x }) as AccountValuation;
  it('sums over accounts, carrying forward the last state', () => {
    const out = totalsOn(
      [
        [v('2024-01-15', 100), v('2024-02-10', 110)],
        [v('2024-02-05', 50)],
      ],
      ['2024-01-31', '2024-02-29', '2024-03-31'],
    );
    expect(out).toEqual([
      { date: '2024-01-31', value: 100 },
      { date: '2024-02-29', value: 160 },
      { date: '2024-03-31', value: 160 },
    ]);
  });
  it('daily: every valuation day of any account; valueOn: latest on or before, null before the first', () => {
    const daily = dailyTotals([[v('2024-01-15', 100), v('2024-02-10', 110)], [v('2024-02-05', 50)]]);
    expect(daily).toEqual([
      { date: '2024-01-15', value: 100 },
      { date: '2024-02-05', value: 150 },
      { date: '2024-02-10', value: 160 },
    ]);
    expect(valueOn(daily, '2024-01-14')).toBeNull();
    expect(valueOn(daily, '2024-01-15')).toBe(100);
    expect(valueOn(daily, '2024-02-07')).toBe(150);
    expect(valueOn(daily, '2030-01-01')).toBe(160);
  });
});
