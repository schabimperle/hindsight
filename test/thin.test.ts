import { describe, expect, it } from 'vitest';
import { lttb, thinRows } from '../src/ui/thin';

const xs = Array.from({ length: 1000 }, (_, i) => i);

describe('lttb', () => {
  it('keeps short lines whole', () => {
    expect(lttb([0, 1, 2], [1, 2, 3], 10)).toEqual([0, 1, 2]);
  });

  it('returns the threshold count with both ends, ascending', () => {
    const picked = lttb(xs, xs.map((x) => Math.sin(x / 20)), 100);
    expect(picked).toHaveLength(100);
    expect(picked[0]).toBe(0);
    expect(picked.at(-1)).toBe(999);
    expect(picked.every((p, i) => i === 0 || p > picked[i - 1])).toBe(true);
  });

  it('keeps a one-day trough', () => {
    const ys = xs.map((x) => (x === 517 ? -50 : x / 10));
    expect(lttb(xs, ys, 50)).toContain(517);
  });
});

describe('thinRows', () => {
  const rows = xs.map((x) => ({ time: x, a: x, b: x % 7, depCount: x === 333 ? 1 : 0 }));

  it('leaves rows untouched up to the threshold', () => {
    expect(thinRows(rows.slice(0, 10), ['a', 'b'], 50).map((r) => r.full)).toEqual(rows.slice(0, 10));
  });

  it('thins each line, keeps marker days on every line and the full row for the tooltip', () => {
    const out = thinRows(rows, ['a', 'b'], 50, (r) => r.depCount > 0);
    expect(out.length).toBeLessThan(110);
    // 50 picked, plus the marker day unless LTTB picked it too
    expect(out.filter((r) => typeof r.a === 'number').length).toBeGreaterThanOrEqual(50);
    expect(out.filter((r) => typeof r.a === 'number').length).toBeLessThanOrEqual(51);
    const marker = out.find((r) => r.time === 333)!;
    expect(marker.a).toBe(333);
    expect(marker.b).toBe(333 % 7);
    expect(out.every((r) => r.full === rows[r.time])).toBe(true);
  });
});
