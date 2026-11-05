import { useAddonTranslation } from '@wealthfolio/addon-sdk';
import { useAmountFormatting, useLocalizationSettings } from '@wealthfolio/ui';
import { useCallback, useMemo } from 'react';
import { makeFormat, type Fmt } from '../model/format';
import type { Translate } from '../model/messages';
import type { Row } from '../model/analysis';

/** Keys assumptions.item1 … itemN in src/i18n. */
export const ASSUMPTION_COUNT = 8;

export interface Texts {
  t: Translate;
  language: string;
}

/** Translations of the addon; values are not HTML-escaped (React escapes when rendering). */
export function useTexts(): Texts {
  const { t, language } = useAddonTranslation();
  const tt = useCallback<Translate>((key, options) => t(key, { ...options, interpolation: { escapeValue: false } }), [t]);
  return { t: tt, language };
}

/** Formats in the host's number and date format (Settings > General), country names in the UI language. */
export function useFmt(currency: string): Fmt {
  const { language } = useAddonTranslation();
  const { locale: numbers } = useLocalizationSettings();
  const money = useAmountFormatting().currencyLocale(currency);
  return useMemo(() => makeFormat(language, currency, { numbers, money }), [language, currency, numbers, money]);
}

/** Display name of a row: real portfolio and unnamed “Not invested” translated. */
export function rowName(t: Translate, row: Row): string {
  if (row.kind === 'actual') return t('table.yourPortfolio');
  if (row.name.trim() === '' && row.variantKind === 'cash') return t('table.notInvested');
  return row.name;
}
