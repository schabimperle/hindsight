/** Minor units that exchanges quote in (pence, cents, agorot): main currency code and factor. */
const MINOR_UNITS: Record<string, [string, number]> = {
  GBp: ['GBP', 0.01],
  GBX: ['GBP', 0.01],
  ZAc: ['ZAR', 0.01],
  ZAC: ['ZAR', 0.01],
  ILA: ['ILS', 0.01],
};

export interface NormalizedCurrency {
  code: string;
  /** Multiplier from the reported unit to the main currency. */
  factor: number;
}

/** `GBp` -> GBP with factor 0.01; everything else unchanged (upper-cased). */
export function normalizeCurrency(ccy: string): NormalizedCurrency {
  const hit = MINOR_UNITS[ccy];
  if (hit) return { code: hit[0], factor: hit[1] };
  return { code: ccy.toUpperCase(), factor: 1 };
}
