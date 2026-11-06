import { countryName } from './countries';

/** Number and date formats in the host's language and the base currency. */
export interface Fmt {
  money(v: number): string;
  /** With sign (+/−); amounts that round to 0 get none. */
  moneySigned(v: number): string;
  pct(v: number | null): string;
  pctSigned(v: number | null): string;
  /** Plain number with one decimal (durations in years). */
  num1(v: number): string;
  date(iso: string): string;
  /** "YYYY-MM" as month/year. */
  month(ym: string): string;
  /** Country ID as a name in the host's language. */
  country(id: string): string;
}

function locale(language: string): string {
  try {
    return Intl.NumberFormat.supportedLocalesOf([language]).length > 0 ? language : 'en';
  } catch {
    return 'en';
  }
}

function currencyFormat(lang: string, currency: string, opts: Intl.NumberFormatOptions): Intl.NumberFormat {
  try {
    return new Intl.NumberFormat(lang, { style: 'currency', currency, ...opts });
  } catch {
    // Unknown currency code: number followed by the code
    const n = new Intl.NumberFormat(lang, { maximumFractionDigits: opts.maximumFractionDigits, signDisplay: opts.signDisplay });
    return { format: (v: number) => `${n.format(v)} ${currency}` } as Intl.NumberFormat;
  }
}

/**
 * `language` is the UI language (country names); `locales` are the host's formatting locales for numbers and
 * dates and for amounts in `currency` (the host's number format is independent of the UI language).
 */
export function makeFormat(language: string, currency: string, locales?: { numbers: string; money: string }): Fmt {
  const ui = locale(language);
  const lang = locales ? locale(locales.numbers) : ui;
  const money = locales ? locale(locales.money) : ui;
  const m0 = currencyFormat(money, currency, { maximumFractionDigits: 0, minimumFractionDigits: 0 });
  const m0s = currencyFormat(money, currency, { maximumFractionDigits: 0, minimumFractionDigits: 0, signDisplay: 'exceptZero' });
  const pct = new Intl.NumberFormat(lang, { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const pctS = new Intl.NumberFormat(lang, { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: 'exceptZero' });
  const n1 = new Intl.NumberFormat(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const day = new Intl.DateTimeFormat(lang, { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' });
  const month = new Intl.DateTimeFormat(lang, { timeZone: 'UTC', month: '2-digit', year: 'numeric' });
  return {
    money: (v) => m0.format(v),
    moneySigned: (v) => m0s.format(Math.abs(v) < 0.5 ? 0 : v),
    pct: (v) => (v === null ? '–' : pct.format(v)),
    pctSigned: (v) => (v === null ? '–' : pctS.format(Math.abs(v) < 0.0005 ? 0 : v)),
    num1: (v) => n1.format(v),
    date: (iso) => (iso ? day.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`)) : '–'),
    month: (ym) => (ym ? month.format(new Date(`${ym.slice(0, 7)}-01T00:00:00Z`)) : '–'),
    country: (id) => countryName(id, ui),
  };
}
