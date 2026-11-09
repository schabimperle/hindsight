/** ISO dates (YYYY-MM-DD) and UTC day arithmetic; no local-time Date pitfalls. */

export function dayNumber(iso: string): number {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  return Date.UTC(y, m - 1, d) / 86400000;
}

/** Equivalent to Python's (d2 - d1).days. */
export function daysBetween(d1: string, d2: string): number {
  return dayNumber(d2) - dayNumber(d1);
}

export function yearOf(iso: string): number {
  return Number(iso.slice(0, 4));
}

export function isoFromDayNumber(n: number): string {
  return new Date(n * 86400000).toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  return isoFromDayNumber(dayNumber(iso) + days);
}

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Last day of the month (m = 1..12). */
export function monthEnd(y: number, m: number): string {
  return isoFromDayNumber(Date.UTC(y, m, 1) / 86400000 - 1);
}

const DAY_FORMATS = new Map<string, Intl.DateTimeFormat>();

function dayFormat(timeZone: string): Intl.DateTimeFormat {
  let f = DAY_FORMATS.get(timeZone);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    } catch {
      f = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' });
    }
    DAY_FORMATS.set(timeZone, f);
  }
  return f;
}

/** Calendar day of a timestamp in the time zone `timeZone` (IANA; unknown -> UTC): a booking at
 * 23:30 UTC on 31 Dec is already 1 Jan in Berlin, a Sydney exchange quote at 23:00 UTC is already
 * the next trading day. Plain dates (YYYY-MM-DD) stay unchanged. */
export function toDay(value: string | Date, timeZone = 'UTC'): string {
  if (typeof value === 'string' && !/[T ]\d{2}:\d{2}/.test(value)) return value.slice(0, 10);
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  // formatToParts, not format(): the 'en-CA' pattern is not guaranteed to be ISO in every ICU build.
  const parts = dayFormat(timeZone).formatToParts(d);
  const part = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
