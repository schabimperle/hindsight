import { QueryClient } from '@tanstack/react-query';
import type { AddonContext } from '@wealthfolio/addon-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import enable from '../src/index';
import { PORTFOLIO_DATA_KEY } from '../src/sources/portfolioUpdates';

vi.mock('../src/ui/App', () => ({ App: () => null }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

const clients: QueryClient[] = [];
afterEach(() => clients.splice(0).forEach((client) => client.clear()));

function fixture() {
  const registration = deferred<() => void>();
  const client = new QueryClient();
  clients.push(client);
  const cleanups: (() => unknown)[] = [];
  let complete: () => unknown = () => { throw new Error('No listener'); };
  const addRoute = vi.fn<(route: { component: () => unknown }) => void>();
  const remove = vi.fn();
  const addItem = vi.fn(() => ({ remove }));
  const warn = vi.fn();
  const ctx = {
    api: {
      events: { portfolio: { onUpdateComplete: (callback: () => unknown) => { complete = callback; return registration.promise; } } },
      query: { getClient: () => client },
      logger: { warn },
    },
    onDisable: (cleanup: () => unknown) => { cleanups.push(cleanup); },
    router: { add: addRoute },
    sidebar: { addItem },
  } as unknown as AddonContext;
  return {
    ctx, registration, client, addRoute, addItem, remove, warn,
    complete: () => complete(),
    disable: () => Promise.all(cleanups.map((cleanup) => cleanup())),
  };
}

describe('addon enable', () => {
  it('registers the event listener before exposing the route and sidebar, using the route context client', async () => {
    const f = fixture();
    const enabled = enable(f.ctx);
    expect(f.addRoute).not.toHaveBeenCalled();
    expect(f.addItem).not.toHaveBeenCalled();
    f.registration.resolve(vi.fn());
    await enabled;
    expect(f.addRoute).toHaveBeenCalledTimes(1);
    expect(f.addItem).toHaveBeenCalledTimes(1);
    const element = f.addRoute.mock.calls[0][0].component() as { props: { ctx: AddonContext } };
    expect(element.props.ctx).toBe(f.ctx);
    expect(element.props.ctx.api.query.getClient()).toBe(f.client);
    f.client.setQueryData([...PORTFOLIO_DATA_KEY, 'synthetic'], 'old');
    await f.complete();
    expect(f.client.getQueryState([...PORTFOLIO_DATA_KEY, 'synthetic'])?.isInvalidated).toBe(true);
    await f.disable();
    expect(f.remove).toHaveBeenCalledTimes(1);
  });

  it('does not expose a route when disabled during asynchronous registration', async () => {
    const f = fixture();
    const enabled = enable(f.ctx);
    await f.disable();
    const unlisten = vi.fn();
    f.registration.resolve(unlisten);
    await enabled;
    expect(unlisten).toHaveBeenCalledTimes(1);
    expect(f.addRoute).not.toHaveBeenCalled();
    expect(f.addItem).not.toHaveBeenCalled();
  });

  it('keeps the addon available and logs when the optional event subscription is rejected', async () => {
    const f = fixture();
    const enabled = enable(f.ctx);
    f.registration.reject(new Error('Event permission denied'));
    await enabled;
    expect(f.warn).toHaveBeenCalledTimes(1);
    expect(f.addRoute).toHaveBeenCalledTimes(1);
    expect(f.addItem).toHaveBeenCalledTimes(1);
    await f.disable();
  });

  it('does not mount after a rejected registration if already disabled', async () => {
    const f = fixture();
    const enabled = enable(f.ctx);
    await f.disable();
    f.registration.reject(new Error('Bridge closed'));
    await enabled;
    expect(f.addRoute).not.toHaveBeenCalled();
    expect(f.addItem).not.toHaveBeenCalled();
    expect(f.warn).not.toHaveBeenCalled();
  });
});
