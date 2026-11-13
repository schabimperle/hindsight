// Renders docs/screenshot-{light,dark}.png from a synthetic portfolio in a fresh, disposable Wealthfolio
// instance (WEALTHFOLIO_URL, auth disabled). Run `npm run package` first.
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = (process.env.WEALTHFOLIO_URL ?? 'http://127.0.0.1:8088').replace(/\/$/, '');
const API = `${BASE}/api/v1`;

// Synthetic stock picker: half-yearly deposits into three stocks, one withdrawal. Few bookings keep the
// chart markers apart over the whole period.
const STOCKS = ['DIS', 'KO', 'JNJ'];
const START = '2019-01-01';
const END = '2026-10-31';
const WITHDRAWAL = { month: '2024-06', amount: 8000 };
const BENCHMARKS = [
  { name: 'S&P 500', ticker: 'SPY', kind: 'asset' },
  { name: 'MSCI World', ticker: 'URTH', kind: 'asset' },
  { name: '60/40', ticker: '', kind: 'mix', rebalance: 'yearly', components: [
    { name: 'S&P 500', ticker: 'SPY', weight: 60 },
    { name: 'US Aggregate Bonds', ticker: 'AGG', weight: 40 },
  ] },
  { name: '', ticker: '', kind: 'cash' },
];

async function api(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/** Daily closes by ISO date. */
async function closes(ticker) {
  const p1 = Date.parse(START) / 1000;
  const p2 = Date.parse(END) / 1000 + 86400;
  const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&period1=${p1}&period2=${p2}`,
    { headers: { 'user-agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`Yahoo ${ticker}: ${res.status}`);
  const r = (await res.json()).chart.result[0];
  const close = r.indicators.quote[0].close;
  return new Map(r.timestamp.flatMap((t, i) => close[i] ? [[new Date(t * 1000).toISOString().slice(0, 10), close[i]]] : []));
}

async function seed() {
  for (let i = 0; ; i++) {
    try { await api('GET', '/accounts'); break; } catch (e) { if (i > 60) throw e; }
    await new Promise((r) => setTimeout(r, 1000));
  }
  await api('PUT', '/settings', { baseCurrency: 'USD', timezone: 'America/New_York', language: 'en', onboardingCompleted: true });
  const account = await api('POST', '/accounts', { name: 'Brokerage', accountType: 'SECURITIES', currency: 'USD', isDefault: true, isActive: true });

  const prices = new Map(await Promise.all(STOCKS.map(async (s) => [s, await closes(s)])));
  const days = [...prices.get(STOCKS[0]).keys()];
  const firstTradingDay = (month) => days.find((d) => d.startsWith(month));
  const asset = (symbol) => ({ symbol, providerId: 'YAHOO', providerSymbol: symbol, quoteCcy: 'USD' });
  const trade = (type, date, symbol, cash) => {
    const unitPrice = Math.round(prices.get(symbol).get(date) * 100) / 100;
    const quantity = Math.round(cash / unitPrice * 1e4) / 1e4;
    return { accountId: account.id, activityType: type, activityDate: date, asset: asset(symbol), quantity, unitPrice, currency: 'USD', fee: 0 };
  };
  const cash = (type, date, amount) => ({ accountId: account.id, activityType: type, activityDate: date, amount, currency: 'USD' });

  const activities = [];
  let n = 0;
  for (let y = 2019; y <= 2026; y++) {
    for (const m of [1, 7]) {
      const date = firstTradingDay(`${y}-${String(m).padStart(2, '0')}`);
      if (!date) continue;
      const amount = [3000, 5000, 2000, 6000, 4000][n % 5] + (y - 2019) * 500;
      activities.push(cash('DEPOSIT', date, amount), trade('BUY', date, STOCKS[n % STOCKS.length], amount));
      n++;
    }
  }
  const wd = firstTradingDay(WITHDRAWAL.month);
  activities.push(trade('SELL', wd, STOCKS[0], WITHDRAWAL.amount), cash('WITHDRAWAL', wd, WITHDRAWAL.amount));
  await api('POST', '/activities/bulk', { creates: activities });
  await api('POST', '/market-data/sync/history', {});

  const zip = readFileSync(new URL('../build/hindsight.zip', import.meta.url)).toString('base64');
  const { network } = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  await api('POST', '/addons/install-zip', { zipDataB64: zip, enableAfterInstall: true, approvedNetworkHosts: network.allowedHosts });
  await api('PUT', '/addons/storage/hindsight/settings:benchmarks', { value: JSON.stringify(BENCHMARKS) });
  await api('PUT', '/addons/storage/hindsight/settings:range', { value: JSON.stringify({ preset: 'ALL' }) });
}

async function shoot(browser, theme) {
  await api('PUT', '/settings', { theme });
  const page = await browser.newPage({ viewport: { width: 1240, height: 1600 }, deviceScaleFactor: 2, locale: 'en-US' });
  // The host may offer an application update; its dialog would cover the controls being clicked.
  await page.addLocatorHandler(page.getByRole('button', { name: 'Remind me later', exact: true }), (button) => button.click());
  await page.goto(BASE);
  await page.getByText('Hindsight', { exact: true }).first().click();
  const addon = page.frameLocator('iframe').first();
  await addon.getByRole('button', { name: 'Show markers' }).click({ timeout: 120_000 });
  await addon.getByRole('row').nth(4).waitFor({ timeout: 120_000 });
  await page.waitForTimeout(3000); // chart animation
  const frame = await page.locator('iframe').first().boundingBox();
  const bottom = await addon.locator('table').evaluate((table) => table.closest('[data-slot="card"]').getBoundingClientRect().bottom);
  await page.screenshot({ path: `docs/screenshot-${theme}.png`, clip: { x: frame.x, y: frame.y, width: frame.width, height: Math.ceil(bottom) + 24 } });
  await page.close();
}

await seed();
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
try {
  for (const theme of ['light', 'dark']) await shoot(browser, theme);
} finally {
  await browser.close();
}
