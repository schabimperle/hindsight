import { registerTranslations, type AddonContext } from '@wealthfolio/addon-sdk';
import type { QueryClient } from '@tanstack/react-query';
import de from './i18n/de.json';
import en from './i18n/en.json';
import { subscribePortfolioUpdates } from './sources/portfolioUpdates';
import { App } from './ui/App';
import './ui/compact.css';

const ROUTE = '/addons/hindsight';

export default async function enable(ctx: AddonContext) {
  registerTranslations({ en, de });
  const client = ctx.api.query.getClient() as QueryClient;
  // The sandbox's client uses TanStack defaults, unlike the host's (no refetch on focus). Returning to the tab
  // reloaded everything and turned one request during a network gap (resume, VPN, Wi-Fi) into an error banner
  // that stayed after the network came back. As on the host, portfolio updates and the user's actions refresh.
  client.setQueryDefaults(['hindsight'], { refetchOnWindowFocus: false });
  const active = await subscribePortfolioUpdates(
    ctx.api.events.portfolio,
    client,
    (cleanup) => ctx.onDisable(cleanup),
    () => ctx.api.logger.warn('Hindsight could not subscribe to portfolio updates; automatic refresh is unavailable.'),
  );
  if (!active) return;
  // Sidebar and route title stay English: they are created before any translation and belong to the host's navigation.
  ctx.router.add({
    id: 'hindsight',
    path: ROUTE,
    title: 'Hindsight',
    component: () => <App ctx={ctx} />,
  });
  const item = ctx.sidebar.addItem({
    id: 'hindsight',
    label: 'Hindsight',
    icon: 'clock',
    route: ROUTE,
    order: 200,
  });
  ctx.onDisable(() => item.remove());
}
