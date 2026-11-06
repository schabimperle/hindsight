import type { RunOutput, VariantResult } from './types';

export const MONEY_TOL = 0.01;
export const RATE_TOL = 1e-6;

const MONEY_KEYS = ['invested', 'deposits', 'withdrawals', 'value', 'gain', 'gainReal', 'shortfall'] as const;
const RATE_KEYS = ['irr', 'irrReal'] as const;

function close(g: number | null, w: number | null, tol: number): boolean {
  if (g === null || w === null) return g === w;
  return Math.abs(g - w) <= tol;
}

function compareResult(label: string, got: VariantResult | undefined, want: VariantResult | undefined, diffs: string[]): void {
  if (!got || !want) {
    diffs.push(`${label}: ${got ? 'missing in expected' : 'missing in result'}`);
    return;
  }
  if ('error' in want || 'error' in got) {
    const g = 'error' in got ? got.error : '(no error)';
    const w = 'error' in want ? want.error : '(no error)';
    if (g !== w) diffs.push(`${label}: error ${g} != ${w}`);
    return;
  }
  for (const k of MONEY_KEYS) if (!close(got[k], want[k], MONEY_TOL)) diffs.push(`${label}.${k}: ${got[k]} != ${want[k]}`);
  for (const k of RATE_KEYS) if (!close(got[k], want[k], RATE_TOL)) diffs.push(`${label}.${k}: ${got[k]} != ${want[k]}`);
  const gd = got.drawdown;
  const wd = want.drawdown;
  if (
    (gd === null) !== (wd === null) ||
    (gd !== null && wd !== null && (!close(gd.max, wd.max, RATE_TOL) || gd.peak !== wd.peak || gd.trough !== wd.trough || gd.recovery !== wd.recovery))
  ) {
    diffs.push(`${label}.drawdown: ${JSON.stringify(gd)} != ${JSON.stringify(wd)}`);
  }
  if (got.uninvestedUntil !== want.uninvestedUntil) {
    diffs.push(`${label}.uninvestedUntil: ${got.uninvestedUntil} != ${want.uninvestedUntil}`);
  }
  const gs = got.shortfalls;
  const ws = want.shortfalls;
  if (gs.length !== ws.length || gs.some((s, i) => s.date !== ws[i].date || !close(s.amount, ws[i].amount, MONEY_TOL))) {
    diffs.push(`${label}.shortfalls: ${JSON.stringify(gs)} != ${JSON.stringify(ws)}`);
  }
  if (JSON.stringify(got.warnings) !== JSON.stringify(want.warnings)) {
    diffs.push(`${label}.warnings: ${JSON.stringify(got.warnings)} != ${JSON.stringify(want.warnings)}`);
  }
}

/** Differences between the TS result and the oracle output (empty = identical within tolerance). */
export function compareRuns(got: RunOutput, want: RunOutput): string[] {
  const diffs: string[] = [];
  if (!close(got.investedNominal, want.investedNominal, MONEY_TOL)) {
    diffs.push(`investedNominal: ${got.investedNominal} != ${want.investedNominal}`);
  }
  if (!close(got.investedReal, want.investedReal, MONEY_TOL)) {
    diffs.push(`investedReal: ${got.investedReal} != ${want.investedReal}`);
  }
  if (got.cpiError !== want.cpiError) diffs.push(`cpiError: ${got.cpiError} != ${want.cpiError}`);
  if (JSON.stringify(got.cpiFilled) !== JSON.stringify(want.cpiFilled)) {
    diffs.push(`cpiFilled: ${JSON.stringify(got.cpiFilled)} != ${JSON.stringify(want.cpiFilled)}`);
  }
  if (got.mwrPeriodDays !== want.mwrPeriodDays) diffs.push(`mwrPeriodDays: ${got.mwrPeriodDays} != ${want.mwrPeriodDays}`);
  if (got.variants.length !== want.variants.length) {
    diffs.push(`variant count: ${got.variants.length} != ${want.variants.length}`);
  }
  want.variants.forEach((w, i) => compareResult(`variants[${i}] (${w.name})`, got.variants[i], w, diffs));
  if (want.actual || got.actual) compareResult('actual', got.actual, want.actual, diffs);
  return diffs;
}
