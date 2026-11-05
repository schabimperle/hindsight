/**
 * Countries with a consumer price index (CPI) at the OECD. Only countries whose monthly CPI lagged
 * by at most 12 months at build time (11/2026) are included; New Zealand (quarterly values only) is
 * therefore missing. Australia's monthly series only starts in 2024-04: older flows yield the hint
 * inflation_missing with country and first month, and no real figures.
 * `areas`: OECD area codes under which the series lives in either of the two dataflows.
 */
export interface CountryDef {
  /** Stored code (ISO 3166-1 alpha-3; euro area: EA). */
  id: string;
  /** ISO 3166-1 alpha-2 code for the country name via Intl.DisplayNames (euro area: EZ). */
  region: string;
  areas: string[];
}

const c = (id: string, region: string, areas: string[] = [id]): CountryDef => ({ id, region, areas });

export const COUNTRIES: CountryDef[] = [
  c('EA', 'EZ', ['EA', 'EA20']),
  c('AUS', 'AU'),
  c('AUT', 'AT'),
  c('BEL', 'BE'),
  c('BGR', 'BG'),
  c('BRA', 'BR'),
  c('CAN', 'CA'),
  c('CHE', 'CH'),
  c('CHL', 'CL'),
  c('CHN', 'CN'),
  c('COL', 'CO'),
  c('CRI', 'CR'),
  c('CZE', 'CZ'),
  c('DEU', 'DE'),
  c('DNK', 'DK'),
  c('ESP', 'ES'),
  c('EST', 'EE'),
  c('FIN', 'FI'),
  c('FRA', 'FR'),
  c('GBR', 'GB'),
  c('GRC', 'GR'),
  c('HRV', 'HR'),
  c('HUN', 'HU'),
  c('IDN', 'ID'),
  c('IND', 'IN'),
  c('IRL', 'IE'),
  c('ISL', 'IS'),
  c('ISR', 'IL'),
  c('ITA', 'IT'),
  c('JPN', 'JP'),
  c('KOR', 'KR'),
  c('LTU', 'LT'),
  c('LUX', 'LU'),
  c('LVA', 'LV'),
  c('MEX', 'MX'),
  c('NLD', 'NL'),
  c('NOR', 'NO'),
  c('POL', 'PL'),
  c('PRT', 'PT'),
  c('SAU', 'SA'),
  c('SVK', 'SK'),
  c('SVN', 'SI'),
  c('SWE', 'SE'),
  c('TUR', 'TR'),
  c('USA', 'US'),
  c('ZAF', 'ZA'),
];

export const countryById = (id: string | null | undefined): CountryDef | null => COUNTRIES.find((x) => x.id === id) ?? null;

/** Name in the UI language (Intl, CLDR). */
export function countryName(id: string, language: string): string {
  const def = countryById(id);
  if (!def) return id;
  try {
    return new Intl.DisplayNames([language, 'en'], { type: 'region' }).of(def.region) ?? id;
  } catch {
    return id;
  }
}

/** Time zones per country; prefixes end in “/”. Only for offered countries. */
const ZONES: Record<string, string[]> = {
  AUS: ['Australia/'],
  AUT: ['Europe/Vienna'],
  BEL: ['Europe/Brussels'],
  BGR: ['Europe/Sofia'],
  BRA: [
    'America/Sao_Paulo', 'America/Manaus', 'America/Fortaleza', 'America/Recife', 'America/Bahia', 'America/Belem',
    'America/Cuiaba', 'America/Campo_Grande', 'America/Porto_Velho', 'America/Rio_Branco', 'America/Noronha',
    'America/Maceio', 'America/Araguaina', 'America/Boa_Vista', 'America/Santarem', 'America/Eirunepe', 'Brazil/',
  ],
  CAN: [
    'America/Toronto', 'America/Vancouver', 'America/Edmonton', 'America/Winnipeg', 'America/Halifax', 'America/St_Johns',
    'America/Regina', 'America/Moncton', 'America/Whitehorse', 'America/Yellowknife', 'America/Iqaluit', 'America/Glace_Bay',
    'America/Goose_Bay', 'America/Swift_Current', 'America/Dawson_Creek', 'America/Fort_Nelson', 'America/Creston',
    'America/Atikokan', 'America/Rankin_Inlet', 'America/Resolute', 'America/Cambridge_Bay', 'America/Inuvik',
    'America/Dawson', 'America/Blanc-Sablon', 'America/Montreal', 'Canada/',
  ],
  CHE: ['Europe/Zurich'],
  CHL: ['America/Santiago', 'America/Punta_Arenas', 'Pacific/Easter', 'Chile/'],
  CHN: ['Asia/Shanghai', 'Asia/Urumqi', 'Asia/Chongqing', 'Asia/Harbin', 'PRC'],
  COL: ['America/Bogota'],
  CRI: ['America/Costa_Rica'],
  CZE: ['Europe/Prague'],
  DEU: ['Europe/Berlin', 'Europe/Busingen'],
  DNK: ['Europe/Copenhagen'],
  ESP: ['Europe/Madrid', 'Atlantic/Canary', 'Africa/Ceuta'],
  EST: ['Europe/Tallinn'],
  FIN: ['Europe/Helsinki'],
  FRA: ['Europe/Paris'],
  GBR: ['Europe/London', 'Europe/Belfast', 'GB'],
  GRC: ['Europe/Athens'],
  HRV: ['Europe/Zagreb'],
  HUN: ['Europe/Budapest'],
  IDN: ['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura', 'Asia/Pontianak'],
  IND: ['Asia/Kolkata', 'Asia/Calcutta'],
  IRL: ['Europe/Dublin'],
  ISL: ['Atlantic/Reykjavik'],
  ISR: ['Asia/Jerusalem', 'Asia/Tel_Aviv'],
  ITA: ['Europe/Rome'],
  JPN: ['Asia/Tokyo', 'Japan'],
  KOR: ['Asia/Seoul'],
  LTU: ['Europe/Vilnius'],
  LUX: ['Europe/Luxembourg'],
  LVA: ['Europe/Riga'],
  MEX: [
    'America/Mexico_City', 'America/Cancun', 'America/Merida', 'America/Monterrey', 'America/Matamoros', 'America/Chihuahua',
    'America/Ojinaga', 'America/Mazatlan', 'America/Bahia_Banderas', 'America/Hermosillo', 'America/Tijuana',
    'America/Ciudad_Juarez', 'Mexico/',
  ],
  NLD: ['Europe/Amsterdam'],
  NOR: ['Europe/Oslo'],
  POL: ['Europe/Warsaw'],
  PRT: ['Europe/Lisbon', 'Atlantic/Madeira', 'Atlantic/Azores'],
  SAU: ['Asia/Riyadh'],
  SVK: ['Europe/Bratislava'],
  SVN: ['Europe/Ljubljana'],
  SWE: ['Europe/Stockholm'],
  TUR: ['Europe/Istanbul', 'Asia/Istanbul'],
  USA: [
    'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Phoenix', 'America/Anchorage',
    'America/Detroit', 'America/Boise', 'America/Juneau', 'America/Sitka', 'America/Nome', 'America/Yakutat',
    'America/Metlakatla', 'America/Adak', 'America/Menominee', 'America/Indiana/', 'America/Kentucky/',
    'America/North_Dakota/', 'America/Louisville', 'Pacific/Honolulu', 'US/',
  ],
  ZAF: ['Africa/Johannesburg'],
};

const CURRENCIES: Record<string, string> = {
  EUR: 'EA', USD: 'USA', GBP: 'GBR', JPY: 'JPN', CAD: 'CAN', AUD: 'AUS', CHF: 'CHE', SEK: 'SWE', NOK: 'NOR', DKK: 'DNK',
  PLN: 'POL', CZK: 'CZE', HUF: 'HUN', KRW: 'KOR', MXN: 'MEX', BRL: 'BRA', INR: 'IND', ZAR: 'ZAF', TRY: 'TUR', ILS: 'ISR',
  ISK: 'ISL', CLP: 'CHL', COP: 'COL', CNY: 'CHN', IDR: 'IDN', SAR: 'SAU', CRC: 'CRI', BGN: 'BGR',
};

export function countryFromTimeZone(tz: string | null | undefined): string | null {
  if (!tz) return null;
  for (const [id, zones] of Object.entries(ZONES)) {
    if (zones.some((z) => (z.endsWith('/') ? tz.startsWith(z) : tz === z))) return id;
  }
  return null;
}

/** Default without an explicit choice: Wealthfolio's time zone, else base currency, else none. */
export function defaultCountry(timeZone: string | null | undefined, baseCurrency: string | null | undefined): string | null {
  return countryFromTimeZone(timeZone) ?? (baseCurrency ? (CURRENCIES[baseCurrency.toUpperCase()] ?? null) : null);
}
