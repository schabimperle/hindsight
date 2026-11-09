import type { Account, AccountValuation, ActivitySearchResponse, Holding, Quote } from '@wealthfolio/addon-sdk';
import { toDay } from '../core/dates';
import type { ActivityRow } from '../core/flows';
import type { PathPoint, PricePoint } from '../core/types';

/** Subset of `ctx.api` that the loader needs (makes testing with stubs easier). */
export interface PortfolioApi {
  accounts: { getAll(): Promise<Account[]> };
  settings: { get(): Promise<{ baseCurrency: string; timezone?: string }> };
  portfolio: {
    getHoldings(accountId: string): Promise<Holding[]>;
    getLatestValuations(ids: string[]): Promise<AccountValuation[]>;
    getHistoricalValuations(accountId?: string): Promise<AccountValuation[]>;
  };
  activities: {
    search(
      page: number,
      pageSize: number,
      filters: { accountIds?: string | string[] },
      searchKeyword: string,
    ): Promise<ActivitySearchResponse>;
  };
  quotes: { getHistory(assetId: string): Promise<Quote[]> };
}

/** Account types that Wealthfolio's Performance page accepts (not CREDIT_CARD) and that are not archived;
 * the same eligibility rule, so Hindsight never analyses what the host would refuse. */
export function accountSupported(a: Account): boolean {
  return !a.isArchived && (a.accountType === 'SECURITIES' || a.accountType === 'CASH' || a.accountType === 'CRYPTOCURRENCY');
}

/** Default selection: eligible and active, without cash accounts of their own (cash held inside a depot counts
 * anyway). A cash account can still be chosen explicitly. */
export function defaultAccountIds(accounts: Account[]): string[] {
  return accounts.filter((a) => accountSupported(a) && a.isActive && a.accountType !== 'CASH').map((a) => a.id);
}

/** Selected IDs that cannot be analysed: unsupported or archived accounts (`name` set) and IDs that no longer
 * exist (`name` null). */
export function unavailableSelection(accounts: Account[], selected: string[] | null): { id: string; name: string | null }[] {
  if (selected === null) return [];
  const byId = new Map(accounts.map((a) => [a.id, a]));
  return selected.flatMap((id) => {
    const a = byId.get(id);
    return a && accountSupported(a) ? [] : [{ id, name: a?.name ?? null }];
  });
}

export interface RealPortfolio {
  baseCurrency: string;
  /** Time zone for booking days (Wealthfolio setting, else the browser's). */
  timeZone: string;
  accountIds: string[];
  /** Today = latest valuation date of the selected accounts. */
  asOf: string | null;
  value: number;
  netContribution: number;
  activities: ActivityRow[];
  /** Today's market value per asset in base currency (sum over the selected accounts). */
  heldValue: Record<string, number>;
  /** Wealthfolio prices (date, close) of the transferred assets, in `quoteCurrencies`. */
  quotes: Record<string, PricePoint[]>;
  quoteCurrencies: Record<string, string>;
  /** Total value (sum over the selected accounts) on every valuation day; opening value of a window and chart. */
  daily: PathPoint[];
  /** Valuation days per selected account with a history (sorted); checks that no account's state is stale. */
  valuationDays: string[][];
  /** A selected account has a value today but no valuation history at all. */
  historyMissing: boolean;
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const PAGE_SIZE = 500;

/** All activities of the accounts; robust against 0- or 1-based page numbering. */
export async function fetchAllActivities(api: PortfolioApi, accountIds: string[]): Promise<ActivityRow[]> {
  const seen = new Map<string, ActivityRow>();
  let total = Infinity;
  // Page numbering (0- or 1-based) is not documented; a page that repeats known rows (e.g. a
  // clamped page 0) is skipped, the loop ends on an empty page, when all rows are in, or (without a total) on a
  // short page.
  for (const start of [0, 1]) {
    let page = start;
    let unproductive = 0;
    for (let guard = 0; guard < 2000; guard++, page++) {
      const res = await api.activities.search(page, PAGE_SIZE, { accountIds }, '');
      total = res.meta?.totalRowCount ?? total;
      const rows = res.data as unknown as ActivityRow[];
      let added = 0;
      for (const row of rows) {
        if (!seen.has(row.id)) {
          seen.set(row.id, row);
          added++;
        }
      }
      // A short page ends the listing only while the total is unknown: a host that caps the page size below
      // PAGE_SIZE would otherwise cut the activities off after the first page.
      if (rows.length === 0 || seen.size >= total || (total === Infinity && rows.length < PAGE_SIZE)) break;
      unproductive = added === 0 ? unproductive + 1 : 0;
      if (unproductive >= 2) break;
    }
    if (seen.size > 0) break;
  }
  return [...seen.values()];
}

/** Total over the accounts on every day any account has a valuation (each account with its latest state on or
 * before that day; accounts without a valuation yet count as 0). */
export function dailyTotals(perAccount: AccountValuation[][], timeZone = 'UTC'): PathPoint[] {
  const days = [...new Set(perAccount.flat().map((v) => toDay(v.valuationDate, timeZone)))].sort();
  return totalsOn(perAccount, days, timeZone);
}

/** Value per account on each day (latest state on or before it), summed over accounts. */
export function totalsOn(perAccount: AccountValuation[][], ends: string[], timeZone = 'UTC'): PathPoint[] {
  const out: PathPoint[] = [];
  const sorted = perAccount.map((v) => [...v].sort((a, b) => (a.valuationDate < b.valuationDate ? -1 : 1)));
  const idx = sorted.map(() => 0);
  const last = sorted.map(() => 0);
  const started = sorted.map(() => false);
  for (const day of ends) {
    let sum = 0;
    let any = false;
    sorted.forEach((vals, k) => {
      while (idx[k] < vals.length && toDay(vals[idx[k]].valuationDate, timeZone) <= day) {
        last[k] = vals[idx[k]].totalValueBase;
        started[k] = true;
        idx[k]++;
      }
      if (started[k]) {
        sum += last[k];
        any = true;
      }
    });
    if (any) out.push({ date: day, value: sum });
  }
  return out;
}

function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export async function loadRealPortfolio(
  api: PortfolioApi,
  selectedIds: string[] | null,
  onProgress?: (msg: string) => void,
): Promise<RealPortfolio> {
  const settings = await api.settings.get();
  const base = settings.baseCurrency;
  const timeZone = settings.timezone || localTimeZone();
  const accounts = await api.accounts.getAll();
  if (selectedIds !== null && unavailableSelection(accounts, selectedIds).length > 0) throw new Error('scope_unavailable');
  const accountIds = selectedIds ?? defaultAccountIds(accounts);
  const empty: RealPortfolio = {
    baseCurrency: base,
    timeZone,
    accountIds,
    asOf: null,
    value: 0,
    netContribution: 0,
    activities: [],
    heldValue: {},
    quotes: {},
    quoteCurrencies: {},
    daily: [],
    valuationDays: [],
    historyMissing: false,
  };
  if (accountIds.length === 0) return empty;

  onProgress?.('activities');
  const activities = await fetchAllActivities(api, accountIds);

  onProgress?.('holdings');
  const holdingsPerAccount = await Promise.all(accountIds.map((id) => api.portfolio.getHoldings(id)));
  const heldValue: Record<string, number> = {};
  for (const hs of holdingsPerAccount) {
    for (const h of hs) {
      const id = (h.instrument as { id?: string } | null | undefined)?.id;
      if (h.holdingType !== 'security' || !id) continue;
      heldValue[id] = (heldValue[id] ?? 0) + (h.marketValue?.base ?? 0);
    }
  }

  onProgress?.('valuations');
  const latest = await api.portfolio.getLatestValuations(accountIds);
  const value = latest.reduce((s, v) => s + v.totalValueBase, 0);
  const netContribution = latest.reduce((s, v) => s + v.netContributionBase, 0);
  const asOf = latest.reduce<string | null>((m, v) => {
    const d = toDay(v.valuationDate, timeZone);
    return m === null || d > m ? d : m;
  }, null);

  onProgress?.('quotes');
  const selected = new Set(accountIds);
  const quoteIds = new Set<string>();
  for (const a of activities) {
    if (!selected.has(a.accountId)) continue;
    if ((a.activityType === 'TRANSFER_IN' || a.activityType === 'TRANSFER_OUT') && a.assetId && !a.assetId.startsWith('$CASH')) {
      quoteIds.add(a.assetId);
    }
  }
  const quotes: Record<string, PricePoint[]> = {};
  const quoteCurrencies: Record<string, string> = {};
  await mapLimit([...quoteIds], 4, async (id) => {
    try {
      const hist = await api.quotes.getHistory(id);
      quotes[id] = hist.map((q): PricePoint => [toDay(q.timestamp, timeZone), q.close]);
      quoteCurrencies[id] = hist[hist.length - 1]?.currency ?? base;
    } catch {
      // Left out: an asset whose prices could not be read is unknown, not worthless (see `loadAll`).
    }
  });

  onProgress?.('history');
  const hist = await Promise.all(accountIds.map((id) => api.portfolio.getHistoricalValuations(id)));
  // The latest valuations are authoritative for today (the history can lag behind by a day).
  const daily = asOf ? [...dailyTotals(hist, timeZone).filter((p) => p.date < asOf), { date: asOf, value }] : [];
  const valuationDays = hist.filter((h) => h.length > 0).map((h) => h.map((v) => toDay(v.valuationDate, timeZone)).sort());
  const historyMissing = hist.some(
    (h, i) => h.length === 0 && (latest.find((v) => v.accountId === accountIds[i])?.totalValueBase ?? 0) > 0,
  );

  return {
    baseCurrency: base,
    timeZone,
    accountIds,
    asOf,
    value,
    netContribution,
    activities,
    heldValue,
    quotes,
    quoteCurrencies,
    daily,
    valuationDays,
    historyMissing,
  };
}

/** Value on `day` from a sorted daily series (latest point on or before it); null before the first point. */
export function valueOn(daily: PathPoint[], day: string): number | null {
  return pointOn(daily, day)?.value ?? null;
}

/** Latest point on or before `day`; null before the first point. */
export function pointOn(daily: PathPoint[], day: string): PathPoint | null {
  let lo = 0;
  let hi = daily.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (daily[mid].date <= day) lo = mid + 1;
    else hi = mid;
  }
  return lo === 0 ? null : daily[lo - 1];
}
