import { DEFAULT_SETTINGS, SETTINGS_KEYS, parseAccounts, parseBenchmarks, parseJson, type AddonSettings } from '../model/settings';
import { parseRange } from '../model/range';
import type { KV } from './http';

export async function loadSettings(storage: KV): Promise<AddonSettings> {
  const [a, b, r] = await Promise.all(
    [SETTINGS_KEYS.accounts, SETTINGS_KEYS.benchmarks, SETTINGS_KEYS.range].map(async (k) => parseJson(await storage.get(k))),
  );
  return {
    accounts: parseAccounts(a),
    benchmarks: b === undefined ? DEFAULT_SETTINGS.benchmarks : parseBenchmarks(b),
    range: parseRange(r),
  };
}

/** Saves the changed parts only (every selector saves right away). */
export async function saveSettings(storage: KV, s: Partial<AddonSettings>): Promise<void> {
  const jobs: Promise<void>[] = [];
  if (s.accounts !== undefined) jobs.push(storage.set(SETTINGS_KEYS.accounts, JSON.stringify(s.accounts)));
  if (s.benchmarks !== undefined) jobs.push(storage.set(SETTINGS_KEYS.benchmarks, JSON.stringify(s.benchmarks)));
  if (s.range !== undefined) jobs.push(storage.set(SETTINGS_KEYS.range, JSON.stringify(s.range)));
  await Promise.all(jobs);
}
