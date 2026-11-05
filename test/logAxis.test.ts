import { describe, expect, it } from 'vitest';
import { makeFormat } from '../src/model/format';
import { logAxis } from '../src/ui/logAxis';

const ranges: [string, number[]][] = [
  ['decades', [100, 1000, 10000]],
  ['short window', [104900, 104950, 105000]],
  ['sub-unit changes', [104999.1, 104999.100000001]],
  ['constant', [100000, 100000]],
  ['small', [0.01, 0.03]],
];
describe.each(ranges)('log axis: %s', (_name, values) => {
  it.each(['de', 'en', 'fr'])('keeps the data extent and distinct labels (%s)', (lang) => {
    const fmt = makeFormat(lang, 'EUR');
    const result = logAxis(values.map((actual) => ({ actual })), ['actual'], fmt.money)!;
    expect(result).not.toBeNull();
    const [min, max] = result.domain;
    expect(min).toBeGreaterThan(0);
    expect(max).toBeGreaterThan(min);
    expect(min).toBeLessThanOrEqual(Math.min(...values));
    expect(max).toBeGreaterThanOrEqual(Math.max(...values));
    if (values[0] !== values.at(-1)) expect(result.domain).toEqual([Math.min(...values), Math.max(...values)]);
    expect(result.ticks.length).toBeGreaterThan(0);
    expect(result.ticks.every((n) => Number.isFinite(n) && n > 0 && n >= min && n <= max)).toBe(true);
    const labels = result.ticks.map(fmt.money);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

it.each([0, -1, NaN, Infinity, -Infinity])('disallows nonpositive/nonfinite visible values: %s', (net) => {
  expect(logAxis([{ actual: 100, net }], ['actual', 'net'], String)).toBeNull();
});
it('ignores missing quotes and data outside the rendered series', () => {
  expect(logAxis([
    { date: '2026-01-01', actual: null, net: 100, failed: -1, wdCount: 0 },
    { date: '2026-01-02', actual: 200, net: 100, failed: 0 },
  ], ['net', 'actual'], String)?.domain).toEqual([100, 200]);
});
it('disallows log when there is no plotted data', () => {
  expect(logAxis([], ['actual', 'net'], String)).toBeNull();
  expect(logAxis([{ actual: null }], ['actual'], String)).toBeNull();
});
