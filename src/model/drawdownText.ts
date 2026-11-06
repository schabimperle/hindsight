import { daysBetween } from '../core/dates';
import type { Drawdown } from '../core/types';
import type { Fmt } from './format';
import type { Translate } from './messages';

/** How a drawdown reads: unavailable (no usable index), none, recovered, or still open at the window end. */
export type DrawdownState =
  | { kind: 'unavailable' }
  | { kind: 'none' }
  | { kind: 'recovered'; max: number; peak: string; trough: string; recovery: string; days: number }
  | { kind: 'open'; max: number; peak: string; trough: string; days: number };

/** `today`: window end; an open drawdown lasts from its peak until then. */
export function drawdownState(dd: Drawdown | null, today: string): DrawdownState {
  if (dd === null) return { kind: 'unavailable' };
  if (dd.peak === null || dd.trough === null || dd.max >= 0) return { kind: 'none' };
  if (dd.recovery !== null) {
    return { kind: 'recovered', max: dd.max, peak: dd.peak, trough: dd.trough, recovery: dd.recovery, days: daysBetween(dd.peak, dd.recovery) };
  }
  return { kind: 'open', max: dd.max, peak: dd.peak, trough: dd.trough, days: daysBetween(dd.peak, today) };
}

/** "12 days", "14 months", "2.5 years". */
export function durationText(t: Translate, fmt: Fmt, days: number): string {
  if (days < 60) return t('drawdown.days', { count: days });
  const months = Math.round(days / 30.4375);
  if (months < 24) return t('drawdown.months', { count: months });
  const years = Math.round((days / 365.25) * 10) / 10;
  return t('drawdown.years', { count: years, value: fmt.num1(years) });
}
