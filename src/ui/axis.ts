import { daysBetween } from '../core/dates';

/** Axis ticks fitting the window: years, months or weeks. */
export function axisTicks(dates: string[], language: string): { ticks: string[]; label: (d: string) => string } {
  const span = dates.length > 1 ? daysBetween(dates[0], dates[dates.length - 1]) : 0;
  // The first tick is the window start. Its label names the whole year/month, so it only stays if that section
  // starts right there; otherwise a short first section would put its label on top of the next one.
  const dropPartialFirst = (ticks: string[], sectionStart: (d: string) => boolean): string[] =>
    ticks.length > 0 && ticks[0] === dates[0] && !sectionStart(dates[0]) ? ticks.slice(1) : ticks;
  if (span > 2 * 366) {
    const years = dates.filter((d, i) => i === 0 || d.slice(0, 4) !== dates[i - 1].slice(0, 4));
    return { ticks: dropPartialFirst(years, (d) => d.slice(5) === '01-01'), label: (d) => d.slice(0, 4) };
  }
  const local = (d: string): Date => new Date(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  if (span > 62) {
    const f = new Intl.DateTimeFormat(language, { month: 'short', year: '2-digit' });
    const months = dates.filter((d, i) => i === 0 || d.slice(0, 7) !== dates[i - 1].slice(0, 7));
    const step = Math.ceil(months.length / 8);
    return { ticks: dropPartialFirst(months.filter((_, i) => i % step === 0), (d) => d.slice(8) === '01'), label: (d) => f.format(local(d)) };
  }
  const f = new Intl.DateTimeFormat(language, { day: 'numeric', month: 'short' });
  const step = Math.max(1, Math.ceil(dates.length / 7));
  return { ticks: dates.filter((_, i) => i % step === 0), label: (d) => f.format(local(d)) };
}
