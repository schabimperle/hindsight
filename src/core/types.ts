export type VariantKind = 'asset' | 'cash' | 'mix';
export type Rebalance = 'yearly' | 'none';

/** Deposit (positive) or withdrawal (negative) in base currency. */
export interface Flow {
  date: string;
  amount: number;
}

export type PricePoint = [string, number | null];

export interface Variant {
  name: string;
  kind: VariantKind;
  /** Prices already in base currency (empty for cash and mixes). */
  points: PricePoint[];
  /** Mix only: components (weights in any unit, normalised to sum 1) and the rebalancing rule. */
  components?: { weight: number; points: PricePoint[] }[];
  rebalance?: Rebalance;
}

export interface Fixture {
  today: string;
  flows: Flow[];
  variants: Variant[];
  /** {"YYYY-MM": index}; null = no real figures. */
  cpi?: Record<string, number> | null;
  /** `daily`: the real portfolio's valuation on fully covered days (time-weighted drawdown). */
  actual?: { value: number; daily?: [string, number][] };
  /** Window start: the real portfolio's value at the end of `date` counts as an opening deposit on that day;
   * flows up to and including `date` are dropped. Without it the window begins with the first flow. */
  start?: { date: string; value: number };
}

export interface Shortfall {
  date: string;
  amount: number;
}

/** Maximum drawdown of a time-weighted index (nominal). `max` 0 means none (both dates null). */
export interface Drawdown {
  /** Lowest index level relative to its running peak, minus 1 (e.g. -0.25). */
  max: number;
  peak: string | null;
  trough: string | null;
}

export interface Report {
  name: string;
  /** Sum of the executed flows. */
  invested: number;
  /** Executed deposits and withdrawals (as a positive amount) that make up `invested`. */
  deposits: number;
  withdrawals: number;
  value: number;
  gain: number;
  irr: number | null;
  gainReal: number | null;
  irrReal: number | null;
  /** Uncovered part of the withdrawals. */
  shortfall: number;
  shortfalls: Shortfall[];
  /** First price day, if money was uninvested before it. */
  uninvestedUntil: string | null;
  /** null: no usable time-weighted index (e.g. the real portfolio's valuation history has gaps). */
  drawdown: Drawdown | null;
  warnings: string[];
}

export interface ErrorResult {
  name: string;
  error: string;
}

export type VariantResult = Report | ErrorResult;

export interface RunOutput {
  investedNominal: number;
  investedReal: number | null;
  /** Inflation data exist but only start after the first flow. */
  cpiError: string | null;
  /** Months inside the CPI series without a value that a flow or the window end falls into (previous month's value used). */
  cpiFilled: string[];
  /** null: money-weighted returns are per year; else they cover the window of this many days (< 365). */
  mwrPeriodDays: number | null;
  variants: VariantResult[];
  actual?: VariantResult;
}

export interface PathPoint {
  date: string;
  value: number;
}

export function isError(r: VariantResult): r is ErrorResult {
  return 'error' in r;
}

/** Parameter of a message; amounts and dates are only formatted in the UI. */
export type MsgParam =
  | string
  | number
  | { money: number }
  | { date: string }
  | { month: string }
  /** List of months "YYYY-MM". */
  | { months: string[] }
  /** Country ID from src/model/countries.ts, in the UI language. */
  | { country: string };

/** Affected booking (for messages with a list). */
export interface BookingRef {
  date: string;
  symbol: string;
  account: string;
}

/** Warning or error as a code with parameters; texts only come from i18n. */
export interface WarningItem {
  code: string;
  params?: Record<string, MsgParam>;
  items?: BookingRef[];
}
