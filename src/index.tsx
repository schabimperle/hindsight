import { registerTranslations, type AddonContext } from '@wealthfolio/addon-sdk';
import de from './i18n/de.json';
import en from './i18n/en.json';
import { App } from './ui/App';

const ROUTE = '/addons/hindsight';

export default function enable(ctx: AddonContext) {
  registerTranslations({ en, de });
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
