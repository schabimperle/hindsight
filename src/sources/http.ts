import type { NetworkRequest, NetworkResponse } from '@wealthfolio/addon-sdk';

/** Minimal dependencies of the data sources; `ctx.api.network` and `ctx.api.storage` satisfy them. */
export interface Net {
  request(req: NetworkRequest): Promise<NetworkResponse>;
}

export interface KV {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export interface FetchDeps {
  net: Net;
  storage: KV;
  nowMs: () => number;
}

export class DataError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'DataError';
  }
}

export const HOUR_MS = 3600 * 1000;

/** Storage key from a prefix and an arbitrary identifier: Wealthfolio only allows letters, digits and
 * `_ . : -`; everything else (e.g. `=` in `USDEUR=X`, `^` in `^GSPC`) is encoded as `_<hex>_`. */
export function storageKey(prefix: string, id: string): string {
  return prefix + id.replace(/[^A-Za-z0-9.:-]|_/g, (c) => `_${c.codePointAt(0)?.toString(16)}_`);
}

export interface CacheEntry<T> {
  /** Fetch time (ms since epoch). */
  f: number;
  /** Earliest requested date the entry covers. */
  from: string;
  d: T;
}

export async function readCache<T>(storage: KV, key: string): Promise<CacheEntry<T> | null> {
  try {
    const raw = await storage.get(key);
    if (!raw) return null;
    const v = JSON.parse(raw) as CacheEntry<T>;
    return typeof v.f === 'number' && typeof v.from === 'string' && v.d !== undefined ? v : null;
  } catch {
    return null;
  }
}

export interface Cached<T> {
  data: T;
  fetchedAt: number;
  /** Network failed, cached data used. */
  stale: boolean;
}

export interface CachedFetchOptions {
  /** Error code if the fetch fails and there is no suitable cache entry. */
  failCode?: string;
  /**
   * Asked after the fetch: false = only partially loaded. Then a covering (even old) cache entry
   * wins; without one the partial result is used but not cached.
   */
  complete?: () => boolean;
}

/**
 * Cache logic for both sources: a fresh entry reaching back far enough is used directly; otherwise
 * fetch, and on a network error fall back to the (old) entry, but only if it covers `from`: a series
 * that starts too late would otherwise look like a late start.
 */
export async function cachedFetch<T>(
  deps: FetchDeps,
  key: string,
  from: string,
  ttlMs: number,
  load: () => Promise<T>,
  { failCode = 'prices_unavailable', complete = () => true }: CachedFetchOptions = {},
): Promise<Cached<T>> {
  const cached = await readCache<T>(deps.storage, key);
  const covering = cached && cached.from <= from ? cached : null;
  const now = deps.nowMs();
  if (covering && now - covering.f < ttlMs) return { data: covering.d, fetchedAt: covering.f, stale: false };
  let data: T;
  try {
    data = await load();
  } catch (e) {
    if (covering) return { data: covering.d, fetchedAt: covering.f, stale: true };
    throw e instanceof DataError ? e : new DataError(failCode);
  }
  if (!complete()) {
    if (covering) return { data: covering.d, fetchedAt: covering.f, stale: true };
    return { data, fetchedAt: now, stale: false };
  }
  try {
    await deps.storage.set(key, JSON.stringify({ f: now, from, d: data } satisfies CacheEntry<T>));
  } catch {
    // The cache is optional (size limit etc.)
  }
  return { data, fetchedAt: now, stale: false };
}
