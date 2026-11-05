import { describe, expect, it } from 'vitest';
import { parseRange, presetFrom, rangeFromDays, subMonthsIso, windowOf } from '../src/model/range';

describe('range', () => {
  it('presets like the host (month arithmetic clamps the day)', () => {
    expect(presetFrom('1W', '2026-11-03')).toBe('2026-10-27');
    expect(presetFrom('1M', '2026-03-31')).toBe('2026-02-28');
    expect(presetFrom('YTD', '2026-11-03')).toBe('2026-01-01');
    expect(presetFrom('5Y', '2024-02-29')).toBe('2019-02-28');
    expect(presetFrom('ALL', '2026-11-03')).toBeNull();
    expect(subMonthsIso('2026-01-15', 13)).toBe('2024-12-15');
  });

  it('parse: presets, custom ranges, anything else = ALL', () => {
    expect(parseRange({ preset: '3Y' })).toEqual({ preset: '3Y' });
    expect(parseRange({ from: '2024-01-01', to: '2025-01-01' })).toEqual({ from: '2024-01-01', to: '2025-01-01' });
    expect(parseRange({ from: '2025-01-01', to: '2024-01-01' })).toEqual({ preset: 'ALL' });
    expect(parseRange({ preset: '1D' })).toEqual({ preset: 'ALL' });
    expect(parseRange(null)).toEqual({ preset: 'ALL' });
  });

  it('window: a preset rolls with asOf, a custom end on or after asOf is "today"', () => {
    expect(windowOf({ preset: '1Y' }, '2026-11-03')).toEqual({ from: '2025-11-03', to: null });
    expect(windowOf({ from: '2024-01-01', to: '2030-01-01' }, '2026-11-03')).toEqual({ from: '2024-01-01', to: null });
    expect(windowOf({ from: '2024-01-01', to: '2025-01-01' }, '2026-11-03')).toEqual({ from: '2024-01-01', to: '2025-01-01' });
  });

  it('back from the selector: presets recognised, 1970 = ALL, a single day is ignored', () => {
    expect(rangeFromDays('2025-11-03', '2026-11-03', '2026-11-03')).toEqual({ preset: '1Y' });
    expect(rangeFromDays('1970-01-01', '2026-11-03', '2026-11-03')).toEqual({ preset: 'ALL' });
    expect(rangeFromDays(null, null, '2026-11-03')).toEqual({ preset: 'ALL' });
    expect(rangeFromDays('2025-11-04', '2026-11-03', '2026-11-03')).toEqual({ from: '2025-11-04', to: '2026-11-03' });
    expect(rangeFromDays('2025-11-04', '2025-11-04', '2026-11-03')).toBeNull();
  });
});
