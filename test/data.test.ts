import { describe, expect, it } from 'vitest';
import { normalizeCurrency } from '../src/core/currency';
import { countryById, countryFromTimeZone, countryName, defaultCountry, COUNTRIES } from '../src/model/countries';
import { DEFAULT_BENCHMARKS, parseBenchmarks } from '../src/model/settings';
import { searchHits } from '../src/model/search';
import { FxRates, toBase } from '../src/sources/fx';
import { DataError, HOUR_MS, storageKey, type FetchDeps } from '../src/sources/http';
import { fetchCpi, oecdUrl, parseOecdCsv, pickSeries } from '../src/sources/oecd';
import { loadSettings } from '../src/sources/settingsStore';
import { fetchYahooSeries, parseYahooChart } from '../src/sources/yahoo';

type Responder = (url: string) => { status: number; body: string } | undefined;

function memoryDeps(respond: Responder, now = { t: Date.parse('2026-06-15T12:00:00Z') }) {
  const store = new Map<string, string>();
  const calls: string[] = [];
  const deps: FetchDeps = {
    net: {
      request: async (r) => {
        calls.push(r.url);
        const res = respond(r.url);
        if (!res) throw new Error('offline');
        return { ...res, headers: {} };
      },
    },
    storage: { get: async (k) => store.get(k) ?? null, set: async (k, v) => void store.set(k, v) },
    nowMs: () => now.t,
  };
  return { deps, store, calls, now };
}

interface ChartOpts {
  currency?: string;
  tz?: string;
  hourUtc?: number;
  adj?: boolean;
}
const chart = (rows: [string, number | null, number | null][], o: ChartOpts = {}) =>
  JSON.stringify({
    chart: {
      result: [
        {
          meta: { currency: o.currency ?? 'USD', exchangeTimezoneName: o.tz ?? 'America/New_York' },
          timestamp: rows.map(([d]) => Date.parse(`${d}T${String(o.hourUtc ?? 14).padStart(2, '0')}:30:00Z`) / 1000),
          indicators: {
            quote: [{ close: rows.map(([, c]) => c) }],
            ...(o.adj === false ? {} : { adjclose: [{ adjclose: rows.map(([, , a]) => a) }] }),
          },
        },
      ],
    },
  });

describe('Yahoo', () => {
  it('takes adjclose, skips null, does not round', () => {
    const r = parseYahooChart(chart([['2024-01-02', 10, 9.1234567], ['2024-01-03', 11, null], ['2024-01-04', 12, 11.5]]));
    expect(r).toEqual({ currency: 'USD', p: [['2024-01-02', 9.1234567], ['2024-01-04', 11.5]] });
  });
  it('without adjclose: close', () => {
    const r = parseYahooChart(chart([['2024-01-02', 10, null]], { adj: false }));
    expect(r.p).toEqual([['2024-01-02', 10]]);
  });
  it('pence -> pounds, trading day in the exchange\'s time zone', () => {
    const gbp = parseYahooChart(chart([['2024-01-02', 802, 800]], { currency: 'GBp', tz: 'Europe/London', hourUtc: 8 }));
    expect(gbp).toEqual({ currency: 'GBP', p: [['2024-01-02', 8]] });
    // ASX: 10:00 Sydney = 23:00 UTC the previous day
    const asx = parseYahooChart(chart([['2025-01-01', 100, 100]], { currency: 'AUD', tz: 'Australia/Sydney', hourUtc: 23 }));
    expect(asx.p[0][0]).toBe('2025-01-02');
  });
  it('minor units', () => {
    expect(normalizeCurrency('GBp')).toEqual({ code: 'GBP', factor: 0.01 });
    expect(normalizeCurrency('GBX')).toEqual({ code: 'GBP', factor: 0.01 });
    expect(normalizeCurrency('ZAc')).toEqual({ code: 'ZAR', factor: 0.01 });
    expect(normalizeCurrency('ILA')).toEqual({ code: 'ILS', factor: 0.01 });
    expect(normalizeCurrency('usd')).toEqual({ code: 'USD', factor: 1 });
  });

  it('URL from first flow - 10 days, versioned 12 h cache, fallback to old cache', async () => {
    const body = chart([['2024-01-02', 10, 10], ['2024-01-03', 11, 11]]);
    const { deps, calls, now, store } = memoryDeps(() => ({ status: 200, body }));
    const a = await fetchYahooSeries(deps, 'BTC-USD', '2024-01-12');
    expect(calls[0]).toContain('/chart/BTC-USD?period1=' + Date.parse('2024-01-02T00:00:00Z') / 1000);
    expect([...store.keys()]).toEqual(['yahoo:v2:BTC-USD']);
    expect(a).toMatchObject({ currency: 'USD', stale: false });
    now.t += 11 * HOUR_MS;
    await fetchYahooSeries(deps, 'BTC-USD', '2024-01-12');
    expect(calls).toHaveLength(1);
    now.t += 2 * HOUR_MS;
    deps.net.request = async () => {
      throw new Error('offline');
    };
    const c = await fetchYahooSeries(deps, 'BTC-USD', '2024-01-12');
    expect(c.stale).toBe(true);
    expect(c.points).toHaveLength(2);
  });

  it('fallback only to a cache that covers the start', async () => {
    const body = chart([['2024-03-01', 10, 10]]);
    const { deps, now } = memoryDeps(() => ({ status: 200, body }));
    await fetchYahooSeries(deps, 'X', '2024-03-11'); // cache from 2024-03-01
    now.t += 13 * HOUR_MS;
    deps.net.request = async () => {
      throw new Error('offline');
    };
    // earlier start: the old entry begins too late and must not fake a late start
    await expect(fetchYahooSeries(deps, 'X', '2024-01-11')).rejects.toMatchObject({ code: 'prices_unavailable' });
    const ok = await fetchYahooSeries(deps, 'X', '2024-03-20');
    expect(ok.stale).toBe(true);
  });

  it('HTTP error without cache -> prices_unavailable, 404 -> ticker_unknown', async () => {
    const { deps } = memoryDeps(() => ({ status: 429, body: '' }));
    await expect(fetchYahooSeries(deps, 'X', '2024-01-10')).rejects.toBeInstanceOf(DataError);
    await expect(fetchYahooSeries(deps, 'X', '2024-01-10')).rejects.toMatchObject({ code: 'prices_unavailable' });
    const { deps: d404 } = memoryDeps(() => ({ status: 404, body: '{}' }));
    await expect(fetchYahooSeries(d404, 'NOPE', '2024-01-10')).rejects.toMatchObject({ code: 'ticker_unknown' });
  });
});

describe('storage keys', () => {
  it('only allowed characters, unique', () => {
    expect(storageKey('yahoo:v2:', 'BTC-USD')).toBe('yahoo:v2:BTC-USD');
    expect(storageKey('yahoo:v2:', 'EUNL.DE')).toBe('yahoo:v2:EUNL.DE');
    const fx = storageKey('yahoo:v2:', 'USDEUR=X');
    const idx = storageKey('yahoo:v2:', '^GSPC');
    expect(fx).toBe('yahoo:v2:USDEUR_3d_X');
    expect(idx).toMatch(/^[A-Za-z0-9_.:-]+$/);
    expect(storageKey('p:', 'a_3d_b')).not.toBe(storageKey('p:', 'a=b'));
  });
});

describe('exchange rates', () => {
  const fxBody = chart(
    [
      ['2024-01-02', 0.9, 0.9],
      ['2024-01-03', 0.92, 0.92],
    ],
    { currency: 'EUR', tz: 'Europe/London', hourUtc: 0 },
  );
  it('converts USD and GBp into EUR (rate on or before the day), loads each pair once', async () => {
    const { deps, calls, store } = memoryDeps((url) => (url.includes('USDEUR%3DX') || url.includes('GBPEUR%3DX') ? { status: 200, body: fxBody } : undefined));
    const fx = new FxRates(deps, 'EUR', '2024-01-01');
    const usd = await toBase(fx, [['2024-01-02', 100], ['2024-01-06', 100], ['2024-01-20', 100]], 'USD');
    expect(usd.points).toEqual([['2024-01-02', 90], ['2024-01-06', 92]]);
    const gbp = await toBase(fx, [['2024-01-03', 1000]], 'GBp');
    expect(gbp.points[0][1]).toBeCloseTo(9.2, 9);
    await toBase(fx, [['2024-01-03', 1]], 'USD');
    expect(calls.filter((u) => u.includes('USDEUR'))).toHaveLength(1);
    for (const k of store.keys()) expect(k).toMatch(/^[A-Za-z0-9_.:-]+$/);
    expect(fx.rate('EUR', '2030-01-01')).toBe(1);
    const eur = await toBase(fx, [['2024-01-03', 5]], 'EUR');
    expect(eur).toEqual({ points: [['2024-01-03', 5]], error: null });
  });
  it('missing pair -> fx_rate_missing', async () => {
    const { deps } = memoryDeps(() => ({ status: 404, body: '' }));
    const r = await toBase(new FxRates(deps, 'EUR', '2024-01-01'), [['2024-01-03', 5]], 'XYZ');
    expect(r).toEqual({ points: [], error: 'fx_rate_missing' });
  });
});

const csv = (rows: [string, string, string, string][]) =>
  ['DATAFLOW,REF_AREA,FREQ,METHODOLOGY,MEASURE,TIME_PERIOD,OBS_VALUE,OBS_STATUS']
    .concat(rows.map(([area, freq, t, v]) => `"OECD.SDD.TPS:X(1.0)",${area},${freq},N,CPI,${t},${v},A`))
    .join('\r\n');

describe('OECD', () => {
  it('reads columns via the header row, monthly values only, sorted', () => {
    const body = csv([
      ['DEU', 'M', '2024-02', '120.5'],
      ['DEU', 'M', '2024-01', '120.1'],
      ['DEU', 'Q', '2024-Q1', '120'],
      ['DEU', 'M', '2024-03', ''],
      ['EA20', 'M', '2024-01', '99'],
    ]);
    const r = parseOecdCsv(body);
    expect(r).toEqual({ DEU: { '2024-01': 120.1, '2024-02': 120.5 }, EA20: { '2024-01': 99 } });
    expect(Object.keys(r.DEU)).toEqual(['2024-01', '2024-02']);
  });
  it('an HTML response is a load error', () => {
    expect(() => parseOecdCsv('<!DOCTYPE HTML><html>Service Unavailable</html>')).toThrow(DataError);
  });
  it('picks the most recent series that covers the start', () => {
    const old = { '2019-01': 1, '2025-12': 2 };
    const recent = { '2019-01': 1, '2026-09': 3 };
    const short = { '2025-01': 1, '2026-10': 3 };
    expect(pickSeries([old, recent, short], '2019-01')).toBe(recent);
    expect(pickSeries([short], '2019-01')).toBe(short);
    expect(pickSeries([{}], '2019-01')).toBeNull();
  });
  it('queries both dataflows, 404 = not contained, caches 24 h', async () => {
    const { deps, calls } = memoryDeps((url) =>
      url.includes('C2018') ? { status: 404, body: 'NoRecordsFound' } : { status: 200, body: csv([['DEU', 'M', '2024-01', '100'], ['DEU', 'M', '2024-02', '101']]) },
    );
    const r = await fetchCpi(deps, countryById('DEU')!, '2024-02-15');
    expect(r.cpi).toEqual({ '2024-01': 100, '2024-02': 101 });
    expect(r.lastMonth).toBe('2024-02');
    expect(calls).toHaveLength(2);
    expect(calls[0]).toBe(oecdUrl('DSD_PRICES@DF_PRICES_ALL,1.0', ['DEU'], '2024-01'));
    expect(calls[0]).toBe('https://sdmx.oecd.org/public/rest/data/OECD.SDD.TPS,DSD_PRICES@DF_PRICES_ALL,1.0/DEU.M.N.CPI.IX._T.N._Z?startPeriod=2024-01');
    await fetchCpi(deps, countryById('DEU')!, '2024-02-15');
    expect(calls).toHaveLength(2);
  });
  it('one dataflow failing -> the other counts but is not cached; both failing -> inflation_unavailable', async () => {
    const { deps, calls, store } = memoryDeps((url) =>
      url.includes('C2018') ? { status: 503, body: '<html></html>' } : { status: 200, body: csv([['FRA', 'M', '2024-01', '100']]) },
    );
    const r = await fetchCpi(deps, countryById('FRA')!, '2024-02-15');
    expect(r).toMatchObject({ cpi: { '2024-01': 100 }, lastMonth: '2024-01', stale: false });
    expect(store.size).toBe(0);
    await fetchCpi(deps, countryById('FRA')!, '2024-02-15');
    expect(calls).toHaveLength(4);
    const both = memoryDeps((url) => (url.includes('C2018') ? { status: 503, body: '' } : undefined));
    await expect(fetchCpi(both.deps, countryById('FRA')!, '2024-02-15')).rejects.toMatchObject({ code: 'inflation_unavailable' });
    const html = memoryDeps(() => ({ status: 200, body: '<html></html>' }));
    await expect(fetchCpi(html.deps, countryById('FRA')!, '2024-02-15')).rejects.toMatchObject({ code: 'inflation_unavailable' });
  });
  it('a partial result loses against an old covering cache; too short without a cache -> load error', async () => {
    let c2018Down = false;
    const { deps, now } = memoryDeps((url) =>
      url.includes('C2018')
        ? c2018Down
          ? { status: 503, body: '' }
          : { status: 200, body: csv([['FRA', 'M', '2024-01', '100'], ['FRA', 'M', '2026-05', '130']]) }
        : { status: 200, body: csv([['FRA', 'M', '2024-01', '100'], ['FRA', 'M', '2025-12', '120']]) },
    );
    expect((await fetchCpi(deps, countryById('FRA')!, '2024-02-15')).lastMonth).toBe('2026-05');
    now.t += 25 * 3600 * 1000;
    c2018Down = true;
    const r = await fetchCpi(deps, countryById('FRA')!, '2024-02-15');
    expect(r).toMatchObject({ lastMonth: '2026-05', stale: true });
    const short = memoryDeps((url) =>
      url.includes('C2018') ? { status: 503, body: '' } : { status: 200, body: csv([['FRA', 'M', '2025-01', '100']]) },
    );
    await expect(fetchCpi(short.deps, countryById('FRA')!, '2024-02-15')).rejects.toMatchObject({ code: 'inflation_unavailable' });
  });
});

describe('countries', () => {
  it('time zone -> country, else base currency, else none', () => {
    expect(countryFromTimeZone('Europe/Berlin')).toBe('DEU');
    expect(countryFromTimeZone('America/Indiana/Indianapolis')).toBe('USA');
    expect(countryFromTimeZone('Australia/Perth')).toBe('AUS');
    expect(countryFromTimeZone('Pacific/Auckland')).toBeNull();
    expect(defaultCountry('Europe/Vienna', 'EUR')).toBe('AUT');
    expect(defaultCountry('Pacific/Auckland', 'GBP')).toBe('GBR');
    expect(defaultCountry(undefined, 'EUR')).toBe('EA');
    expect(defaultCountry('Pacific/Auckland', 'NZD')).toBeNull();
  });
  it('names in the UI language; codes unique', () => {
    expect(countryName('DEU', 'de')).toBe('Deutschland');
    expect(countryName('DEU', 'en')).toBe('Germany');
    expect(countryName('EA', 'en')).toBe('Eurozone');
    expect(new Set(COUNTRIES.map((c) => c.id)).size).toBe(COUNTRIES.length);
  });
});

describe('settings', () => {
  it('parseBenchmarks: new shape and migration of old entries with taxClass', () => {
    const r = parseBenchmarks([
      { name: 'A', ticker: ' X.DE ', taxClass: 'fund', teilfreistellung: 0.15 },
      { name: 'B', ticker: '', taxClass: 'fund' },
      { name: 'Not invested', ticker: '', taxClass: 'cash', teilfreistellung: 0 },
      { name: 'Gold', ticker: '4GLD.DE', taxClass: 's23' },
      { name: 'D', ticker: 'Y', kind: 'asset' },
      { name: 'E', ticker: 'Y' },
    ]);
    expect(r).toEqual([
      { name: 'A', ticker: 'X.DE', kind: 'asset' },
      { name: 'Not invested', ticker: '', kind: 'cash' },
      { name: 'Gold', ticker: '4GLD.DE', kind: 'asset' },
      { name: 'D', ticker: 'Y', kind: 'asset' },
    ]);
    expect(parseBenchmarks('broken')).toEqual(DEFAULT_BENCHMARKS);
  });
  it('international default list', () => {
    expect(DEFAULT_BENCHMARKS.map((b) => b.ticker)).toEqual(['BTC-USD', 'ETH-USD', 'URTH', 'ACWI', 'SPY', 'GLD', '']);
  });
  it('old keys (tax, inflation) are ignored; range defaults to ALL', async () => {
    const store = new Map<string, string>([
      ['settings:tax', '{"personalRate":0.42}'],
      ['settings:extraTaxes', '{"2021":123}'],
      ['settings:inflation', '{"country":"FRA"}'],
      ['settings:benchmarks', '[{"name":"MSCI World","ticker":"EUNL.DE","taxClass":"fund","teilfreistellung":0.3}]'],
    ]);
    const s = await loadSettings({ get: async (k) => store.get(k) ?? null, set: async () => undefined });
    expect(s).toEqual({ accounts: null, benchmarks: [{ name: 'MSCI World', ticker: 'EUNL.DE', kind: 'asset' }], range: { preset: 'ALL' } });
  });
});

describe('search', () => {
  it('only Yahoo-loadable hits, Yahoo symbol as ticker, no duplicates', () => {
    const base = { exchange: 'NMS', shortName: 'S', quoteType: 'ETF', index: '', score: 1, typeDisplay: 'ETF', longName: '' };
    const hits = searchHits([
      { ...base, symbol: 'BRK.B', providerSymbol: 'BRK-B', providerId: 'YAHOO', longName: 'Berkshire', currency: 'USD', exchangeName: 'NYSE' },
      { ...base, symbol: 'BRK.B', providerSymbol: 'BRK-B', providerId: 'YAHOO' },
      { ...base, symbol: 'X', providerId: 'ALPHA_VANTAGE' },
      { ...base, symbol: 'MYHOUSE', dataSource: 'MANUAL' },
      { ...base, symbol: 'MYCOIN', quoteMode: 'MANUAL', isExisting: true } as never,
      { ...base, symbol: 'URTH' },
    ]);
    expect(hits.map((h) => [h.name, h.ticker])).toEqual([
      ['Berkshire', 'BRK-B'],
      ['S', 'URTH'],
    ]);
    expect(hits[0]).toMatchObject({ exchange: 'NYSE', currency: 'USD', type: 'ETF' });
  });
});
