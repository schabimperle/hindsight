import { DEFAULT_BAND, REBALANCE_RULES, type Rebalance, type VariantKind } from '../core/types';
import { DEFAULT_RANGE, type RangeSetting } from './range';

export interface MixComponent {
  name: string;
  /** Yahoo ticker. */
  ticker: string;
  /** Percent; the weights of a mix sum to 100. */
  weight: number;
}

export interface BenchmarkDef {
  name: string;
  /** Yahoo ticker; empty for “Not invested”; for a mix its identity (`mixIdentity`, recomputed when read). */
  ticker: string;
  kind: VariantKind;
  /** Mix only: 2 to 5 components with distinct tickers, and the rebalancing rule. */
  components?: MixComponent[];
  rebalance?: Rebalance;
  /** Threshold rule only: allowed drift in percentage points (`validBand`). */
  band?: number;
}

export const MIX_MIN = 2;
export const MIX_MAX = 5;
/** Weights may be entered with two decimals; their sum must be 100 within this tolerance. */
export const MIX_SUM_TOL = 0.005;

/** Identity of a mix, independent of the component order and ticker case: same composition and rule (with its band)
 * = same mix. */
export function mixIdentity(components: MixComponent[], rebalance: Rebalance, band = DEFAULT_BAND): string {
  const parts = components
    .map((c) => `${c.ticker.trim().toUpperCase()}*${Math.round(c.weight * 100) / 100}`)
    .sort();
  return `mix:${parts.join('+')}|${rebalance}${rebalance === 'threshold' ? `:${band}` : ''}`;
}

/** Drift band of the threshold rule: 0.1 to 50 percentage points (a share cannot drift further in a two-asset 50/50
 * mix), with at most one decimal. */
export function validBand(band: unknown): band is number {
  return typeof band === 'number' && Number.isFinite(band) && band >= 0.1 && band <= 50 && Math.abs(band * 10 - Math.round(band * 10)) < 1e-6;
}

/** Validated components (null if the mix is incomplete or invalid). */
export function validMix(components: MixComponent[]): MixComponent[] | null {
  if (components.length < MIX_MIN || components.length > MIX_MAX) return null;
  const tickers = new Set<string>();
  for (const c of components) {
    const t = c.ticker.trim().toUpperCase();
    // At most two decimals, so the identity, the name and the simulation see the same weights.
    const twoDecimals = Number.isFinite(c.weight) && Math.abs(c.weight * 100 - Math.round(c.weight * 100)) < 1e-6;
    if (t === '' || tickers.has(t) || !twoDecimals || c.weight <= 0) return null;
    tickers.add(t);
  }
  const sum = components.reduce((s, c) => s + c.weight, 0);
  return Math.abs(sum - 100) <= MIX_SUM_TOL ? components.map((c) => ({ ...c, ticker: c.ticker.trim() })) : null;
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

function parseMix(b: Record<string, unknown>): BenchmarkDef | null {
  if (typeof b.name !== 'string' || !Array.isArray(b.components)) return null;
  const raw = b.components.map((c) =>
    isObj(c) && typeof c.ticker === 'string' && typeof c.weight === 'number'
      ? { name: typeof c.name === 'string' ? c.name : c.ticker, ticker: c.ticker, weight: c.weight }
      : null,
  );
  if (raw.includes(null)) return null;
  const components = validMix(raw as MixComponent[]);
  if (!components) return null;
  const rebalance: Rebalance = REBALANCE_RULES.includes(b.rebalance as Rebalance) ? (b.rebalance as Rebalance) : 'yearly';
  if (rebalance !== 'threshold') return { name: b.name, ticker: mixIdentity(components, rebalance), kind: 'mix', components, rebalance };
  const band = validBand(b.band) ? b.band : DEFAULT_BAND;
  return { name: b.name, ticker: mixIdentity(components, rebalance, band), kind: 'mix', components, rebalance, band };
}

/** Reads `{name, ticker, kind}` and mixes; older entries with `taxClass` are migrated (cash -> cash, else asset).
 * Note: versions before mixes skip them when reading and drop them for good once they save the list again. */
export function parseBenchmarks(v: unknown): BenchmarkDef[] {
  if (!Array.isArray(v)) return DEFAULT_BENCHMARKS;
  const out: BenchmarkDef[] = [];
  for (const b of v) {
    if (isObj(b) && b.kind === 'mix') {
      const m = parseMix(b);
      if (m) out.push(m);
      continue;
    }
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
