import { getNiceTickValues } from 'recharts';
import { describe, expect, it } from 'vitest';
import { makeFormat } from '../src/model/format';

// Recharts' automatic domain must use whole-unit ticks to match the money formatter.
const ranges: [string, [number, number]][] = [
  ['six months', [100000, 105000]],
  ['one week', [104900, 105000]],
  ['sub-euro changes', [104999.1, 104999.5]],
  ['floating-point noise', [104999.1, 104999.1000000001]],
  ['constant value', [100000, 100000]],
  ['zero', [0, 0]],
  ['small balance', [0.01, 0.03]],
  ['negative balance', [-105000, -100000]],
  ['crossing zero', [-100, 100]],
  ['million', [1000000, 1500000]],
];

describe.each(ranges)('Y-axis: %s', (_name, domain) => {
  it.each(['de', 'en', 'fr'])('keeps ticks and formatted labels distinct (%s)', (language) => {
    const ticks = getNiceTickValues(domain, 5, false);
    expect(ticks.length).toBeGreaterThan(1);
    expect(ticks.every(Number.isInteger)).toBe(true);
    expect(ticks[0]).toBeLessThanOrEqual(domain[0]);
    expect(ticks.at(-1)).toBeGreaterThanOrEqual(domain[1]);
    const fmt = makeFormat(language, 'EUR');
    const labels = ticks.map((value) => fmt.money(value));
    expect(new Set(labels).size).toBe(ticks.length);
  });
});

it('uses the host money locale even when the UI language differs', () => {
  const fmt = makeFormat('de', 'EUR', { numbers: 'en-US', money: 'en-US' });
  const labels = getNiceTickValues([104900, 105000], 5, false).map((v) => fmt.money(v));
  expect(labels).toEqual(['€104,900', '€104,925', '€104,950', '€104,975', '€105,000']);
});
