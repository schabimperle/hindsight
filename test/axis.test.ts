import { describe, expect, it } from 'vitest';
import { addDays } from '../src/core/dates';
import { axisTicks } from '../src/ui/axis';

/** Weekly points from `start`, as the chart samples multi-year windows. */
const weekly = (start: string, count: number): string[] => Array.from({ length: count }, (_, i) => addDays(start, i * 7));
const labels = (dates: string[]): string[] => {
  const { ticks, label } = axisTicks(dates, 'en');
  return ticks.map(label);
};

describe('axisTicks', () => {
  it('drops the label of a first year that is not complete', () => {
    expect(labels(weekly('2023-11-06', 157))).toEqual(['2024', '2025', '2026']);
    expect(labels(weekly('2023-03-06', 157))).toEqual(['2024', '2025', '2026']);
  });

  it('keeps the first year when the window starts on 1 January', () => {
    expect(labels(weekly('2023-01-01', 160))).toEqual(['2023', '2024', '2025', '2026']);
  });

  it('drops a partial first month, keeps a complete one', () => {
    const from = (start: string): string[] => Array.from({ length: 200 }, (_, i) => addDays(start, i));
    const partial = labels(from('2025-10-29'));
    expect(partial[0]).toBe('Nov 25');
    expect(labels(from('2025-10-01'))[0]).toBe('Oct 25');
  });
});
