import { normalizeCurrency } from './currency';
import { daysBetween, toDay } from './dates';
import type { BookingRef, Flow, WarningItem } from './types';

/** Row of `ctx.api.activities.search`; `sourceGroupId` is missing from the SDK type but present at runtime. */
export interface ActivityRow {
  id: string;
  accountId: string;
  accountName?: string;
  accountCurrency?: string;
  activityType: string;
  date: string | Date;
  amount?: string | null;
  quantity?: string | null;
  unitPrice?: string | null;
  currency?: string;
  fxRate?: string | null;
  status?: string;
  sourceGroupId?: string | null;
  assetId?: string | null;
  assetSymbol?: string | null;
  instrumentType?: string | null;
}

export interface FlowContext {
  base: string;
  /** Time zone in which booking timestamps become calendar days. */
  timeZone: string;
  /** Value of 1 unit of `ccy` (main currency, e.g. GBP) in base currency on or before `day`; null = unknown. */
  fx: (ccy: string, day: string) => number | null;
  /** Wealthfolio price of the asset in base currency on or before `day`, else after (each at most 10 days);
   * null = none. */
  quoteOn: (assetId: string, day: string) => number | null;
  /** true if the asset has neither a value in the selected accounts today nor ever a price > 0 (e.g. a spam token). */
  worthless: (assetId: string) => boolean;
}

export interface FlowsResult {
  /** One flow per booking (not netted), sorted by date. */
  flows: Flow[];
  warnings: WarningItem[];
  /** Asset transfers without a determinable value: block the analysis. */
  unvalued: BookingRef[];
  /** Deposits/withdrawals and cash transfers in a foreign currency without an exchange rate: block the analysis. */
  unconverted: BookingRef[];
}

function num(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const isTransfer = (a: ActivityRow): boolean => a.activityType === 'TRANSFER_IN' || a.activityType === 'TRANSFER_OUT';

function isAssetTransfer(a: ActivityRow): boolean {
  const q = num(a.quantity);
  const id = a.assetId ?? '';
  if (q === null || q === 0 || id === '') return false;
  if (id.startsWith('$CASH') || a.instrumentType === 'CASH') return false;
  return true;
}

/** Amount in the booking's currency -> base currency; null if no exchange rate is known. */
function amountToBase(amount: number, a: ActivityRow, day: string, ctx: FlowContext): number | null {
  const { code, factor } = normalizeCurrency(a.currency || ctx.base);
  if (code === ctx.base) return amount * factor;
  // fxRate converts into the account currency; only usable if the account is kept in the base currency.
  const fxRate = num(a.fxRate);
  if (fxRate !== null && fxRate > 0 && (a.accountCurrency || ctx.base) === ctx.base) return amount * fxRate;
  const r = ctx.fx(code, day);
  return r === null ? null : amount * factor * r;
}

interface ExternalTransfer {
  a: ActivityRow;
  day: string;
  /** Quantity (asset) or amount (cash), positive. */
  size: number;
  /** Asset ID or currency. */
  key: string;
  value: number;
}

/** Ungrouped TRANSFER_OUT/TRANSFER_IN pairs between different selected accounts (same asset or
 * currency, quantity +-1 %, at most 7 days apart): reported, because they count as deposit/withdrawal. */
function unlinkedPairs(transfers: ExternalTransfer[]): { count: number; sum: number } {
  const outs = transfers.filter((t) => t.a.activityType === 'TRANSFER_OUT');
  const used = new Set<ExternalTransfer>();
  let count = 0;
  let sum = 0;
  const ins = transfers.filter((t) => t.a.activityType === 'TRANSFER_IN').sort((x, y) => (x.day < y.day ? -1 : 1));
  for (const t of ins) {
    const hit = outs.find(
      (o) =>
        !used.has(o) &&
        o.key === t.key &&
        o.a.accountId !== t.a.accountId &&
        Math.abs(daysBetween(o.day, t.day)) <= 7 &&
        Math.abs(o.size - t.size) <= 0.01 * Math.max(o.size, t.size),
    );
    if (!hit) continue;
    used.add(hit);
    count++;
    sum += t.value;
  }
  return { count, sum };
}

/**
 * Derives the external cash flows (deposits positive, withdrawals negative, base currency) of the
 * selected accounts. A transfer is internal (does not count) exactly when a counterpart with the
 * same `sourceGroupId` lies in the selected accounts.
 */
export function deriveFlows(activities: ActivityRow[], selected: ReadonlySet<string>, ctx: FlowContext): FlowsResult {
  const counts = new Map<string, number>();
  const warn = (code: string): void => {
    counts.set(code, (counts.get(code) ?? 0) + 1);
  };
  const rows = activities.filter((a) => selected.has(a.accountId) && (a.status === undefined || a.status === 'POSTED'));

  const groupMembers = new Map<string, number>();
  for (const a of rows) {
    if (isTransfer(a) && a.sourceGroupId) groupMembers.set(a.sourceGroupId, (groupMembers.get(a.sourceGroupId) ?? 0) + 1);
  }

  const flows: Flow[] = [];
  const unvalued: BookingRef[] = [];
  const unconverted: BookingRef[] = [];
  const external: ExternalTransfer[] = [];
  const ref = (a: ActivityRow, day: string, symbol: string): BookingRef => ({ date: day, symbol, account: a.accountName || a.accountId });
  const cashRef = (a: ActivityRow, day: string): BookingRef => ref(a, day, normalizeCurrency(a.currency || '?').code);

  for (const a of rows) {
    const day = toDay(a.date, ctx.timeZone);
    if (a.activityType === 'DEPOSIT' || a.activityType === 'WITHDRAWAL') {
      const amount = num(a.amount);
      if (amount === null || amount === 0) continue;
      const v = amountToBase(Math.abs(amount), a, day, ctx);
      if (v === null) {
        unconverted.push(cashRef(a, day));
        continue;
      }
      flows.push({ date: day, amount: a.activityType === 'DEPOSIT' ? v : -v });
      continue;
    }
    if (!isTransfer(a)) continue; // BUY, SELL, DIVIDEND, INTEREST, CREDIT, FEE, TAX, SPLIT, ADJUSTMENT, UNKNOWN
    if (a.sourceGroupId && (groupMembers.get(a.sourceGroupId) ?? 0) > 1) continue; // internal transfer
    const sign = a.activityType === 'TRANSFER_IN' ? 1 : -1;
    if (isAssetTransfer(a)) {
      const assetId = a.assetId as string;
      const qty = Math.abs(num(a.quantity) as number);
      const unitPrice = num(a.unitPrice);
      let v: number | null = null;
      if (unitPrice !== null && unitPrice > 0) v = amountToBase(qty * unitPrice, a, day, ctx);
      if (v === null) {
        const q = ctx.quoteOn(assetId, day);
        if (q !== null) v = qty * q;
      }
      if (v === null) {
        if (ctx.worthless(assetId)) warn('asset_transfer_worthless');
        else unvalued.push(ref(a, day, a.assetSymbol || assetId));
        continue;
      }
      flows.push({ date: day, amount: sign * v });
      external.push({ a, day, size: qty, key: `asset:${assetId}`, value: v });
    } else {
      const amount = num(a.amount);
      if (amount === null || amount === 0) continue;
      const v = amountToBase(Math.abs(amount), a, day, ctx);
      if (v === null) {
        unconverted.push(cashRef(a, day));
        continue;
      }
      flows.push({ date: day, amount: sign * v });
      external.push({ a, day, size: Math.abs(amount), key: `cash:${a.currency ?? ''}`, value: v });
    }
  }
  flows.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
  const warnings: WarningItem[] = [...counts].map(([code, count]) => ({ code, params: { count } }));
  const pairs = unlinkedPairs(external);
  if (pairs.count > 0) {
    warnings.push({ code: 'transfers_unlinked', params: { count: pairs.count, sum: { money: pairs.sum } } });
  }
  return { flows, warnings, unvalued, unconverted };
}

/** Cross-check of the derived flows against Wealthfolio's net contribution; null = fine. */
export function crossCheck(flows: Flow[], netContributionBase: number): WarningItem | null {
  const sum = flows.reduce((s, f) => s + f.amount, 0);
  const tolerance = Math.max(50, 0.01 * Math.max(Math.abs(sum), Math.abs(netContributionBase)));
  if (Math.abs(sum - netContributionBase) <= tolerance) return null;
  return {
    code: 'net_contribution_mismatch',
    params: { flowsSum: { money: sum }, netContribution: { money: netContributionBase } },
  };
}
