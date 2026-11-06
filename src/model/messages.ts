import type { MsgParam, WarningItem } from '../core/types';
import type { Fmt } from './format';

/** All warning and error codes from the core and the data layer; text under `messages.<code>` in src/i18n. */
export const MESSAGE_CODES = [
  'no_prices',
  'prices_missing',
  'prices_stale',
  'prices_unavailable',
  'ticker_unknown',
  'currency_unknown',
  'fx_rate_missing',
  'inflation_missing',
  'inflation_gap',
  'inflation_unavailable',
  'inflation_stale',
  'inflation_cache_stale',
  'fx_rates_cache_stale',
  'cache_stale',
  'withdrawal_uncovered',
  'late_start',
  'late_start_partial',
  'foreign_currency_no_rate',
  'asset_transfer_unvalued',
  'asset_transfer_worthless',
  'transfers_unlinked',
  'no_deposits',
  'no_deposits_window',
  'window_empty',
  'valuation_missing',
  'no_accounts',
  'net_contribution_mismatch',
] as const;

const KNOWN = new Set<string>(MESSAGE_CODES);

export type Translate = (key: string, options?: Record<string, unknown>) => string;

function formatParam(p: MsgParam, fmt: Fmt): string | number {
  if (typeof p === 'object') {
    if ('money' in p) return fmt.money(p.money);
    if ('date' in p) return fmt.date(p.date);
    if ('months' in p) return p.months.map((m) => fmt.month(m)).join(', ');
    if ('country' in p) return fmt.country(p.country);
    return fmt.month(p.month);
  }
  return p;
}

/** Plain text of a message in the host's language; amounts and dates in the host's format. */
export function messageText(t: Translate, fmt: Fmt, w: WarningItem): string {
  if (!KNOWN.has(w.code)) return t('messages.unknown', { code: w.code });
  const opts: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(w.params ?? {})) opts[k] = formatParam(v, fmt);
  if (w.items) opts.count = w.items.length;
  return t(`messages.${w.code}`, opts);
}

/** Text for a bare error code (row error). */
export const codeText = (t: Translate, fmt: Fmt, code: string): string => messageText(t, fmt, { code });
