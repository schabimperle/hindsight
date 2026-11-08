import type { Drawdown } from '../core/types';

/** How a drawdown reads: unavailable (no usable index), none, or a fall from `peak` to `trough`. */
export type DrawdownState =
  | { kind: 'unavailable' }
  | { kind: 'none' }
  | { kind: 'fall'; max: number; peak: string; trough: string };

export function drawdownState(dd: Drawdown | null): DrawdownState {
  if (dd === null) return { kind: 'unavailable' };
  if (dd.peak === null || dd.trough === null || dd.max >= 0) return { kind: 'none' };
  return { kind: 'fall', max: dd.max, peak: dd.peak, trough: dd.trough };
}
