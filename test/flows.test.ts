import { describe, expect, it } from 'vitest';
import { crossCheck, deriveFlows, type ActivityRow, type FlowContext } from '../src/core/flows';

let n = 0;
const act = (o: Partial<ActivityRow> & Pick<ActivityRow, 'activityType'>): ActivityRow => ({
  id: `a${++n}`,
  accountId: 'A',
  accountName: 'Depot A',
  date: '2024-03-05T12:00:00+00:00',
  currency: 'EUR',
  status: 'POSTED',
  ...o,
});
const ctx = (o: Partial<FlowContext> = {}): FlowContext => ({
  base: 'EUR',
  timeZone: 'Europe/Berlin',
  fx: () => null,
  quoteOn: () => null,
  worthless: () => false,
  ...o,
});
const sel = new Set(['A', 'B']);

describe('deriveFlows', () => {
  it('deposit/withdrawal, selected accounts only, sorted by date, day in the time zone', () => {
    const r = deriveFlows(
      [
        act({ activityType: 'WITHDRAWAL', amount: '50', date: '2024-04-30T23:30:00+00:00' }),
        act({ activityType: 'DEPOSIT', amount: '100' }),
        act({ activityType: 'DEPOSIT', amount: '999', accountId: 'X' }),
      ],
      sel,
      ctx(),
    );
    expect(r.flows).toEqual([
      { date: '2024-03-05', amount: 100 },
      { date: '2024-05-01', amount: -50 },
    ]);
    expect(r.warnings).toEqual([]);
    expect(r.unvalued).toEqual([]);
    expect(r.unconverted).toEqual([]);
  });

  it('non-flows are ignored, as are unposted activities', () => {
    const types = ['BUY', 'SELL', 'DIVIDEND', 'INTEREST', 'CREDIT', 'FEE', 'TAX', 'SPLIT', 'ADJUSTMENT', 'UNKNOWN'];
    const rows = types.map((t) => act({ activityType: t, amount: '100' }));
    rows.push(act({ activityType: 'DEPOSIT', amount: '10', status: 'DRAFT' }));
    expect(deriveFlows(rows, sel, ctx()).flows).toEqual([]);
  });

  it('foreign currency: fxRate for an account in base currency, else daily rate; without a rate a blocking list', () => {
    const r = deriveFlows(
      [
        act({ activityType: 'DEPOSIT', amount: '100', currency: 'USD', fxRate: '0.9', accountCurrency: 'EUR' }),
        act({ activityType: 'DEPOSIT', amount: '100', currency: 'USD', fxRate: '0.5', accountCurrency: 'USD' }),
        act({ activityType: 'DEPOSIT', amount: '100', currency: 'CHF', fxRate: null }),
        act({ activityType: 'WITHDRAWAL', amount: '10', currency: 'GBp', date: '2024-03-07T10:00:00Z', accountId: 'B', accountName: 'Account B' }),
        act({ activityType: 'TRANSFER_IN', amount: '50', currency: 'CHF', assetId: '$CASH-CHF', date: '2024-03-08T10:00:00Z' }),
      ],
      sel,
      ctx({ fx: (c) => (c === 'USD' ? 0.8 : null) }),
    );
    expect(r.flows.map((f) => f.amount)).toEqual([expect.closeTo(90, 9), expect.closeTo(80, 9)]);
    expect(r.warnings).toEqual([]);
    expect(r.unconverted).toEqual([
      { date: '2024-03-05', symbol: 'CHF', account: 'Depot A' },
      { date: '2024-03-07', symbol: 'GBP', account: 'Account B' },
      { date: '2024-03-08', symbol: 'CHF', account: 'Depot A' },
    ]);
  });

  it('internal transfer only with a counterpart of the same group in the selected accounts', () => {
    const r = deriveFlows(
      [
        act({ activityType: 'TRANSFER_OUT', amount: '500', sourceGroupId: 'g1', accountId: 'A' }),
        act({ activityType: 'TRANSFER_IN', amount: '500', sourceGroupId: 'g1', accountId: 'B' }),
      ],
      sel,
      ctx(),
    );
    expect(r.flows).toEqual([]);
  });

  it('bank -> broker: a group whose bank side is not selected is external', () => {
    const r = deriveFlows(
      [
        act({ activityType: 'TRANSFER_OUT', amount: '500', sourceGroupId: 'g2', accountId: 'DKB' }),
        act({ activityType: 'TRANSFER_IN', amount: '500', sourceGroupId: 'g2', accountId: 'A' }),
      ],
      sel,
      ctx(),
    );
    expect(r.flows).toEqual([{ date: '2024-03-05', amount: 500 }]);
    expect(r.warnings).toEqual([]);
  });

  it('asset transfer: unitPrice before Wealthfolio price, unitPrice 0 = missing', () => {
    const r = deriveFlows(
      [
        act({ activityType: 'TRANSFER_IN', assetId: 'btc', quantity: '0.1', unitPrice: '30000' }),
        act({ activityType: 'TRANSFER_IN', assetId: 'btc', quantity: '0.1', unitPrice: '0', date: '2024-03-06T10:00:00Z' }),
        act({ activityType: 'TRANSFER_OUT', assetId: 'vusa', quantity: '10', unitPrice: '80', currency: 'GBP', date: '2024-04-01T10:00:00Z' }),
      ],
      sel,
      ctx({ quoteOn: (id) => (id === 'btc' ? 20000 : null), fx: (c) => (c === 'GBP' ? 1.2 : null) }),
    );
    expect(r.flows.map((f) => [f.date, Math.round(f.amount * 100) / 100])).toEqual([
      ['2024-03-05', 3000],
      ['2024-03-06', 2000],
      ['2024-04-01', -960],
    ]);
  });

  it('asset transfer without value: error list, unless the asset is worthless', () => {
    const r = deriveFlows(
      [
        act({ activityType: 'TRANSFER_IN', assetId: 'etf', assetSymbol: 'EUNL', quantity: '3', accountName: 'Depot A' }),
        act({ activityType: 'TRANSFER_IN', assetId: 'spam', quantity: '1000' }),
      ],
      sel,
      ctx({ worthless: (id) => id === 'spam' }),
    );
    expect(r.flows).toEqual([]);
    expect(r.unvalued).toEqual([{ date: '2024-03-05', symbol: 'EUNL', account: 'Depot A' }]);
    expect(r.warnings).toEqual([{ code: 'asset_transfer_worthless', params: { count: 1 } }]);
  });

  it('ungrouped transfers between selected accounts: count as external, warning with sum', () => {
    const r = deriveFlows(
      [
        act({ activityType: 'TRANSFER_OUT', amount: '1000', accountId: 'A', date: '2024-03-01T10:00:00Z' }),
        act({ activityType: 'TRANSFER_IN', amount: '995', accountId: 'B', date: '2024-03-05T10:00:00Z' }),
        act({ activityType: 'TRANSFER_IN', amount: '1000', accountId: 'B', date: '2024-03-20T10:00:00Z' }), // too late
        act({ activityType: 'TRANSFER_OUT', assetId: 'btc', quantity: '0.5', accountId: 'B', date: '2024-05-01T10:00:00Z' }),
        act({ activityType: 'TRANSFER_IN', assetId: 'btc', quantity: '0.5', accountId: 'A', date: '2024-05-02T10:00:00Z' }),
      ],
      sel,
      ctx({ quoteOn: () => 100 }),
    );
    expect(r.flows).toHaveLength(5);
    expect(r.warnings).toEqual([{ code: 'transfers_unlinked', params: { count: 2, sum: { money: 1045 } } }]);
  });
});

describe('crossCheck', () => {
  const flows = [{ date: '2024-01-01', amount: 10000 }];
  it('within max(50, 1 %) is fine', () => {
    expect(crossCheck(flows, 10090)).toBeNull();
    expect(crossCheck(flows, 9900.5)).toBeNull();
  });
  it('above that a warning with both amounts', () => {
    expect(crossCheck(flows, 10200)).toEqual({
      code: 'net_contribution_mismatch',
      params: { flowsSum: { money: 10000 }, netContribution: { money: 10200 } },
    });
  });
});
