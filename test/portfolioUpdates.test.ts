import { QueryClient, QueryObserver } from '@tanstack/react-query';
import type { AddonContext } from '@wealthfolio/addon-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PORTFOLIO_DATA_KEY, subscribePortfolioUpdates } from '../src/sources/portfolioUpdates';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

const clients: QueryClient[] = [];
const cleanupObservers: (() => void)[] = [];
afterEach(() => {
  cleanupObservers.splice(0).forEach((stop) => stop());
  clients.splice(0).forEach((client) => client.clear());
});

function fixture(registration?: Promise<void>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  let complete: () => unknown = () => { throw new Error('No listener'); };
  let disable = () => {};
  const unlisten = vi.fn();
  const events: Pick<AddonContext['api']['events']['portfolio'], 'onUpdateComplete'> = {
    onUpdateComplete: async (callback) => {
      complete = () => callback({ payload: null } as never);
      await registration;
      return unlisten;
    },
  };
  const ready = subscribePortfolioUpdates(events, client, (cleanup) => { disable = cleanup; });
  return { client, ready, complete: () => complete(), disable: () => disable(), unlisten };
}

function observe(client: QueryClient, queryFn: () => Promise<string>) {
  const key = [...PORTFOLIO_DATA_KEY, 'synthetic-accounts', 'synthetic-benchmarks'];
  const observer = new QueryObserver(client, { queryKey: key, queryFn, retry: false });
  cleanupObservers.push(observer.subscribe(() => {}));
  return { key, observer };
}

describe('portfolio update completion', () => {
  it('recovers a failed initial holdings read without retrying before completion', async () => {
    const f = fixture();
    await f.ready;
    const load = vi.fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('Holdings are updating'))
      .mockResolvedValue('current');
    const { observer } = observe(f.client, load);
    await vi.waitFor(() => expect(observer.getCurrentResult().isError).toBe(true));
    expect(load).toHaveBeenCalledTimes(1);
    await f.complete();
    expect(observer.getCurrentResult().data).toBe('current');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it.each(['resolve', 'reject'] as const)('replaces an initial in-flight read even if it later %ss', async (settle) => {
    const f = fixture();
    await f.ready;
    const old = deferred<string>();
    const load = vi.fn<() => Promise<string>>().mockReturnValueOnce(old.promise).mockResolvedValue('current');
    const { observer } = observe(f.client, load);
    expect(load).toHaveBeenCalledTimes(1);
    await f.complete();
    expect(load).toHaveBeenCalledTimes(2);
    expect(observer.getCurrentResult().data).toBe('current');
    if (settle === 'resolve') old.resolve('obsolete');
    else old.reject(new Error('Old holdings read failed'));
    await old.promise.catch(() => {});
    await Promise.resolve();
    expect(observer.getCurrentResult().data).toBe('current');
    expect(observer.getCurrentResult().isError).toBe(false);
  });

  it('refreshes cached data, marks inactive scopes stale and leaves settings and unrelated queries intact', async () => {
    const f = fixture();
    await f.ready;
    const load = vi.fn<() => Promise<string>>().mockResolvedValueOnce('old').mockResolvedValue('new');
    const { observer } = observe(f.client, load);
    await vi.waitFor(() => expect(observer.getCurrentResult().data).toBe('old'));
    const inactive = [...PORTFOLIO_DATA_KEY, 'other-scope'];
    f.client.setQueryData(inactive, 'inactive');
    f.client.setQueryData(['hindsight', 'settings'], 'settings');
    f.client.setQueryData(['other-addon'], 'unrelated');
    await f.complete();
    expect(observer.getCurrentResult().data).toBe('new');
    expect(f.client.getQueryState(inactive)?.isInvalidated).toBe(true);
    expect(f.client.getQueryState(['hindsight', 'settings'])?.isInvalidated).toBe(false);
    expect(f.client.getQueryState(['other-addon'])?.isInvalidated).toBe(false);
  });

  it('unsubscribes and ignores late callbacks after disabling', async () => {
    const f = fixture();
    await f.ready;
    const cancel = vi.spyOn(f.client, 'cancelQueries');
    f.disable();
    f.disable();
    expect(f.unlisten).toHaveBeenCalledTimes(1);
    await f.complete();
    expect(cancel).not.toHaveBeenCalled();
  });

  it('cleans up an asynchronous subscription that finishes after disabling', async () => {
    const registered = deferred<void>();
    const f = fixture(registered.promise);
    f.disable();
    registered.resolve();
    expect(await f.ready).toBe(false);
    expect(f.unlisten).toHaveBeenCalledTimes(1);
  });

  it('does not refetch if disabled while cancellation is pending', async () => {
    const f = fixture();
    await f.ready;
    const cancelled = deferred<void>();
    vi.spyOn(f.client, 'cancelQueries').mockReturnValue(cancelled.promise);
    const invalidate = vi.spyOn(f.client, 'invalidateQueries');
    const completion = f.complete();
    f.disable();
    cancelled.resolve();
    await completion;
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('propagates registration failures so the host reports addon initialization failure', async () => {
    const f = fixture(Promise.reject(new Error('Event permission denied')));
    await expect(f.ready).rejects.toThrow('Event permission denied');
    f.disable();
    expect(f.unlisten).not.toHaveBeenCalled();
  });
});
