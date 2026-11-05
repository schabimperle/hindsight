import type { VariantKind } from '../core/types';
import { DEFAULT_RANGE, type RangeSetting } from './range';

export interface BenchmarkDef {
  name: string;
  /** Yahoo ticker; empty for “Not invested”. */
  ticker: string;
  kind: VariantKind;
}

export interface AddonSettings {
  /** null = default selection (active, non-archived accounts without type CASH). */
  accounts: string[] | null;
  benchmarks: BenchmarkDef[];
  /** Analysed period (date range selector). */
  range: RangeSetting;
}

/** Default for new installs; stored lists stay unchanged. */
export const DEFAULT_BENCHMARKS: BenchmarkDef[] = [
  { name: 'Bitcoin', ticker: 'BTC-USD', kind: 'asset' },
  { name: 'Ethereum', ticker: 'ETH-USD', kind: 'asset' },
  { name: 'MSCI World', ticker: 'URTH', kind: 'asset' },
  { name: 'MSCI ACWI', ticker: 'ACWI', kind: 'asset' },
  { name: 'S&P 500', ticker: 'SPY', kind: 'asset' },
  { name: 'Gold', ticker: 'GLD', kind: 'asset' },
  // Empty name: the UI shows “Not invested” in the host's language.
  { name: '', ticker: '', kind: 'cash' },
];

export const DEFAULT_SETTINGS: AddonSettings = {
  accounts: null,
  benchmarks: DEFAULT_BENCHMARKS,
  range: DEFAULT_RANGE,
};

/** Storage keys: one small JSON document each (values are limited to about 250 KB). The former keys
 * settings:tax, settings:extraTaxes, settings:assetClasses and settings:inflation (the CPI country is always
 * automatic now) are ignored. */
export const SETTINGS_KEYS = {
  accounts: 'settings:accounts',
  benchmarks: 'settings:benchmarks',
  range: 'settings:range',
} as const;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function parseAccounts(v: unknown): string[] | null {
  return Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : null;
}

/** Reads `{name, ticker, kind}`; older entries with `taxClass` are migrated (cash -> cash, else asset). */
export function parseBenchmarks(v: unknown): BenchmarkDef[] {
  if (!Array.isArray(v)) return DEFAULT_BENCHMARKS;
  const out: BenchmarkDef[] = [];
  for (const b of v) {
    if (!isObj(b) || typeof b.name !== 'string') continue;
    let kind: VariantKind | null = b.kind === 'asset' || b.kind === 'cash' ? b.kind : null;
    if (kind === null && typeof b.taxClass === 'string') kind = b.taxClass === 'cash' ? 'cash' : 'asset';
    if (kind === null) continue;
    const ticker = kind === 'cash' ? '' : typeof b.ticker === 'string' ? b.ticker.trim() : '';
    if (kind === 'asset' && ticker === '') continue;
    out.push({ name: b.name, ticker, kind });
  }
  return out;
}

export function parseJson(raw: string | null): unknown {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
