// Stand-in for the i18n runtime of the Wealthfolio sandbox: a real i18next instance of its own, so tests
// can check interpolation and plural forms. `setTestLanguage` switches the language.
import i18next, { type i18n } from 'i18next';
import type { AddonTranslationResources } from '@wealthfolio/addon-sdk';

const inst: i18n = i18next.createInstance();
void inst.init({ lng: 'en', fallbackLng: 'en', resources: {}, initAsync: false, interpolation: { escapeValue: true } });

globalThis.__wealthfolioAddonI18n = {
  registerTranslations: (resources: AddonTranslationResources) => {
    for (const [lng, bundle] of Object.entries(resources)) inst.addResourceBundle(lng, 'translation', bundle, true, true);
  },
  useAddonTranslation: () => ({ t: (key, options) => inst.t(key, options) as string, language: inst.language }),
};

export async function setTestLanguage(lng: string): Promise<void> {
  await inst.changeLanguage(lng);
}
