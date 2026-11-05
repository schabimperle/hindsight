import { addDays, pad2 } from '../core/dates';
import type { Window } from './analysis';

/** The host's DateRangeSelector presets (Insights > Performance hides 1D, so does Hindsight). */
export const PRESETS = ['1W', '1M', '3M', '6M', 'YTD', '1Y', '3Y', '5Y', 'ALL'] as const;
export type Preset = (typeof PRESETS)[number];

/** Stored range: a preset rolls forward with today; a custom range keeps its days. */
export type RangeSetting = { preset: Preset } | { from: string; to: string };

export const DEFAULT_RANGE: RangeSetting = { preset: 'ALL' };

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function parseRange(v: unknown): RangeSetting {
  if (typeof v !== 'object' || v === null) return DEFAULT_RANGE;
  const o = v as Record<string, unknown>;
  if (typeof o.preset === 'string' && (PRESETS as readonly string[]).includes(o.preset)) return { preset: o.preset as Preset };
  if (typeof o.from === 'string' && typeof o.to === 'string' && ISO.test(o.from) && ISO.test(o.to) && o.from < o.to) {
    return { from: o.from, to: o.to };
  }
  return DEFAULT_RANGE;
}

/** `iso` minus n months, the day clamped to the month's length (as date-fns `subMonths`). */
export function subMonthsIso(iso: string, n: number): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7)) - 1 - n;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  const last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
  return `${yy}-${pad2(mm + 1)}-${pad2(Math.min(Number(iso.slice(8, 10)), last))}`;
}

/** Start day of a preset relative to `asOf` (same arithmetic as the host's presets); null for ALL. */
export function presetFrom(p: Preset, asOf: string): string | null {
  switch (p) {
    case '1W':
      return addDays(asOf, -7);
    case '1M':
      return subMonthsIso(asOf, 1);
    case '3M':
      return subMonthsIso(asOf, 3);
    case '6M':
      return subMonthsIso(asOf, 6);
    case 'YTD':
      return `${asOf.slice(0, 4)}-01-01`;
    case '1Y':
      return subMonthsIso(asOf, 12);
    case '3Y':
      return subMonthsIso(asOf, 36);
    case '5Y':
      return subMonthsIso(asOf, 60);
    case 'ALL':
      return null;
  }
}

export function windowOf(r: RangeSetting, asOf: string): Window {
  if ('preset' in r) return { from: presetFrom(r.preset, asOf), to: null };
  return { from: r.from, to: r.to >= asOf ? null : r.to };
}

/** Back from the selector's days: a preset if it matches one (end = asOf), else a custom range; no range or a
 * start in 1970 (the host's ALL sentinel) = ALL. null = no usable range (a single day or an end before the start,
 * e.g. while picking in the calendar): keep the current setting. */
export function rangeFromDays(from: string | null, to: string | null, asOf: string): RangeSetting | null {
  if (from === null || from <= '1970-01-01') return { preset: 'ALL' };
  const end = to ?? asOf;
  if (end >= asOf) {
    const p = PRESETS.find((x) => x !== 'ALL' && presetFrom(x, asOf) === from);
    if (p) return { preset: p };
  }
  return from < end ? { from, to: end } : null;
}

/** Local calendar day of a Date (the selector works with local dates). */
export const isoOfLocal = (d: Date): string => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
export const localOfIso = (iso: string): Date => new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
