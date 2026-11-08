import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { registerTranslations, useAddonTranslation } from '@wealthfolio/addon-sdk';
import { beforeAll, describe, expect, it } from 'vitest';
import de from '../src/i18n/de.json';
import en from '../src/i18n/en.json';
import { makeFormat } from '../src/model/format';
import { MESSAGE_CODES, messageText, type Translate } from '../src/model/messages';
import { GUIDE_COUNTS } from '../src/ui/i18n';
import { setTestLanguage } from './setup';

type Bundle = { [k: string]: string | Bundle };
const flatten = (b: Bundle, prefix = ''): string[] =>
  Object.entries(b).flatMap(([k, v]) => (typeof v === 'string' ? [`${prefix}${k}`] : flatten(v, `${prefix}${k}.`)));
const enKeys = new Set(flatten(en as Bundle));
const hasKey = (key: string): boolean => enKeys.has(key) || (enKeys.has(`${key}_one`) && enKeys.has(`${key}_other`));

const srcRoot = new URL('../src/', import.meta.url).pathname;
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [],
  );
}
const read = (f: string): string => readFileSync(f, 'utf8');
/** Source text without comments (line and block comments). */
const code = (f: string): string => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

describe('translations', () => {
  it('en and de have the same keys', () => {
    expect(flatten(de as Bundle).sort()).toEqual([...enKeys].sort());
  });

  it('every message code has a text, every key in use exists', () => {
    for (const c of MESSAGE_CODES) expect(hasKey(`messages.${c}`), c).toBe(true);
    for (const [part, n] of Object.entries(GUIDE_COUNTS)) {
      expect(enKeys.has(`guide.${part}Title`), part).toBe(true);
      for (let i = 1; i <= n; i++) expect(enKeys.has(`guide.${part}${i}`), `${part}${i}`).toBe(true);
      expect(enKeys.has(`guide.${part}${n + 1}`), `${part}${n + 1}`).toBe(false);
    }
    const used = files(join(srcRoot, 'ui')).flatMap((f) => [...code(f).matchAll(/\bt\(\s*'([^']+)'/g)].map((m) => m[1]));
    expect(used.length).toBeGreaterThan(50);
    for (const k of used) expect(hasKey(k), k).toBe(true);
  });

  it('all codes from core, data layer and model are known', () => {
    const known = new Set<string>(MESSAGE_CODES);
    const pattern = /(?:DataError|PriceError|warn)\(\s*'([a-z_]+)'|\bcode: '([a-z_]+)'|warnings\.push\('([a-z_]+)'\)|error: '([a-z_]+)'/g;
    const found = ['core', 'sources', 'model'].flatMap((d) =>
      files(join(srcRoot, d)).flatMap((f) => [...code(f).matchAll(pattern)].map((m) => m[1] ?? m[2] ?? m[3] ?? m[4])),
    );
    expect(found.length).toBeGreaterThan(15);
    for (const c of found) expect(known.has(c), c).toBe(true);
  });

  it('no hard-coded texts in src/ui', () => {
    for (const f of files(join(srcRoot, 'ui'))) {
      const src = code(f);
      // JSX text with letters between tags
      const jsxText = [...src.matchAll(/>\s*([^<>{}\n]*[A-Za-zÄÖÜäöüß][^<>{}\n]*)\s*</g)]
        .map((m) => m[1].trim())
        .filter((s) => !/^[\w.]+\s*(=>|&&|\|\||\?|\)|,)/.test(s) && !/[=;(]/.test(s));
      expect(jsxText, f).toEqual([]);
      const attrs = [...src.matchAll(/\b(aria-label|placeholder|title|label|sheetTitle)="([^"]*[A-Za-z][^"]*)"/g)].map((m) => m[0]);
      expect(attrs, f).toEqual([]);
      expect(/[ÄÖÜäöüß]/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')), `${f} contains German text`).toBe(false);
    }
  });
});

describe('messages via i18next (interpolation, plural, formats)', () => {
  let t: Translate;
  beforeAll(() => {
    registerTranslations({ en, de });
    const api = useAddonTranslation();
    t = (key, opts) => api.t(key, { ...opts, interpolation: { escapeValue: false } });
  });

  it('German', async () => {
    await setTestLanguage('de');
    const f = makeFormat('de', 'EUR');
    const booking = { date: '2024-01-01', symbol: 'CHF', account: 'A' };
    expect(messageText(t, f, { code: 'foreign_currency_no_rate', params: { currency: 'EUR' }, items: [booking] })).toMatch(
      /^Für diese Buchung in Fremdwährung gibt es keinen Wechselkurs nach EUR /,
    );
    expect(messageText(t, f, { code: 'foreign_currency_no_rate', params: { currency: 'EUR' }, items: [booking, booking] })).toMatch(
      /^Für diese Buchungen in Fremdwährung/,
    );
    expect(
      messageText(t, f, {
        code: 'inflation_missing',
        params: { country: { country: 'AUS' }, month: { month: '2024-04' }, date: { date: '2019-01-03' } },
      }),
    ).toBe('Inflationsdaten für Australien beginnen erst mit 04/2024, nach der ersten Ein- oder Auszahlung (03.01.2019); reale Werte entfallen.');
    expect(messageText(t, f, { code: 'inflation_gap', params: { months: { months: ['2025-10'] }, count: 1 } })).toBe(
      'Für 10/2025 fehlen Inflationsdaten; verwendet wird der letzte veröffentlichte Monat davor.',
    );
    expect(messageText(t, f, { code: 'inflation_stale', params: { month: { month: '2026-01' } } })).toBe(
      'Inflationsdaten reichen nur bis 01/2026; spätere Monate verwenden diesen Wert.',
    );
    expect(
      messageText(t, f, { code: 'withdrawal_uncovered', params: { count: 1, date: { date: '2023-07-15' }, amount: { money: 20861.04 } } }),
    ).toMatch(/^Eine Auszahlung am 15\.07\.2023 .*; 20\.861\s\u20ac waren nicht gedeckt/);
    expect(messageText(t, f, { code: 'asset_transfer_unvalued', items: [{ date: '2024-01-01', symbol: 'X', account: 'A' }] })).toMatch(/^Der Wert dieser Sachübertragung/);
    expect(messageText(t, f, { code: 'not_a_code' })).toBe('Unbekanntes Problem (not_a_code).');
  });

  it('English as base and fallback', async () => {
    await setTestLanguage('en');
    const f = makeFormat('en', 'USD');
    expect(messageText(t, f, { code: 'transfers_unlinked', params: { count: 2, sum: { money: 1045 } } })).toBe(
      '2 transfers between selected accounts are not linked and count as deposits and withdrawals (total $1,045).',
    );
    expect(messageText(t, f, { code: 'inflation_gap', params: { months: { months: ['2025-10', '2025-11'] }, count: 2 } })).toBe(
      'Inflation data lack 10/2025, 11/2025; each uses the latest published month before it.',
    );
    expect(
      messageText(t, f, {
        code: 'inflation_missing',
        params: { country: { country: 'AUS' }, month: { month: '2024-04' }, date: { date: '2019-01-03' } },
      }),
    ).toBe('Inflation data for Australia only start in 04/2024, after the first deposit or withdrawal (01/03/2019); real figures are not shown.');
    await setTestLanguage('fr');
    expect(t('table.yourPortfolio')).toBe('Your portfolio');
  });
});
