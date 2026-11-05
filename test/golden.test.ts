import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareRuns } from '../src/core/compare';
import { run } from '../src/core/report';
import type { Fixture, RunOutput } from '../src/core/types';

const read = <T>(name: string): T => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as T;

describe.each(['synthetic', 'synthetic-edge', 'synthetic-window', 'synthetic-short'])('golden test %s against reference/oracle.py', (name) => {
  const fx = read<Fixture>(`${name}.json`);
  const want = read<RunOutput>(`${name}.expected.json`);
  const got = run(fx);

  it('matches within tolerance', () => {
    expect(compareRuns(got, want)).toEqual([]);
  });

  it.skipIf(name === 'synthetic-window' || name === 'synthetic-short')('covers error, shortfall and late start', () => {
    expect(want.variants.some((v) => 'error' in v)).toBe(true);
    const warnings = want.variants.flatMap((v) => ('warnings' in v ? v.warnings : []));
    expect(warnings).toContain('withdrawal_uncovered');
    expect(warnings).toContain('late_start');
  });

  it.runIf(name === 'synthetic-short')('short window: MWR over the window, opening on a Sunday', () => {
    expect(want.mwrPeriodDays).toBe(29);
    expect(new Date(`${fx.start?.date}T00:00:00Z`).getUTCDay()).toBe(0);
  });

  it.runIf(name === 'synthetic-window')('window: opening value, custom end, late start inside the window', () => {
    expect(fx.start).toBeDefined();
    expect(fx.flows.some((f) => f.date > fx.today)).toBe(true);
    const warnings = want.variants.flatMap((v) => ('warnings' in v ? v.warnings : []));
    expect(warnings).toContain('late_start');
  });

  it('compareRuns detects differences', () => {
    const bad = structuredClone(got);
    const v = bad.variants.find((x) => 'value' in x);
    if (v && 'value' in v) v.value += 1;
    expect(compareRuns(bad, want).length).toBeGreaterThan(0);
  });
});
