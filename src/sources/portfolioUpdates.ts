import type { AddonContext } from '@wealthfolio/addon-sdk';
import type { QueryClient } from '@tanstack/react-query';

export const PORTFOLIO_DATA_KEY = ['hindsight', 'data'] as const;
type PortfolioEvents = Pick<AddonContext['api']['events']['portfolio'], 'onUpdateComplete'>;

/** Listen before mounting queries: the host's startup calculation can make holdings temporarily unreadable. */
export async function subscribePortfolioUpdates(
  events: PortfolioEvents,
  client: QueryClient,
  onDisable: (cleanup: () => void) => void,
  onSubscribeError: () => void,
): Promise<boolean> {
  let stopped = false;
  let unlisten: (() => void) | undefined;
  onDisable(() => {
    stopped = true;
    const stop = unlisten;
    unlisten = undefined;
    return stop?.();
  });
  const stop = await events.onUpdateComplete(async () => {
    if (stopped) return;
    // Invalidation alone can reuse an initial in-flight query and retain its pending-holdings failure.
    await client.cancelQueries({ queryKey: PORTFOLIO_DATA_KEY });
    if (!stopped) await client.invalidateQueries({ queryKey: PORTFOLIO_DATA_KEY });
  }).catch(() => {
    if (!stopped) onSubscribeError();
    return undefined;
  });
  if (stopped) {
    await stop?.();
    return false;
  }
  unlisten = stop;
  return true;
}
