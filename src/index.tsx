import { registerTranslations, type AddonContext } from '@wealthfolio/addon-sdk';
import type { QueryClient } from '@tanstack/react-query';
import de from './i18n/de.json';
import en from './i18n/en.json';
import { subscribePortfolioUpdates } from './sources/portfolioUpdates';
import { App } from './ui/App';

const ROUTE = '/addons/hindsight';

export default async function enable(ctx: AddonContext) {
  registerTranslations({ en, de });
  const listening = await subscribePortfolioUpdates(ctx.api.events.portfolio, ctx.api.query.getClient() as QueryClient, (cleanup) => ctx.onDisable(cleanup));
  if (!listening) return;
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
