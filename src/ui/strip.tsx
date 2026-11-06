import type { Report } from '../core/types';
import type { Analysis } from '../model/analysis';
import { drawdownState, durationText } from '../model/drawdownText';
import type { Fmt } from '../model/format';
import type { Translate } from '../model/messages';
import type { MetricSection } from './MetricStrip';
import { gainClass } from './styles';

const signed = (fmt: Fmt, v: number | null) => <span className={gainClass(v)}>{v === null ? '–' : fmt.moneySigned(v)}</span>;
const pct = (fmt: Fmt, v: number | null) => <span className={gainClass(v)}>{fmt.pctSigned(v)}</span>;

/** Metrics of the selected item in the host's strip layout: return and capital (nominal; the real figures are in
 * the comparison table below); the gain difference only for an alternative (`actual` = the real portfolio's report
 * to compare with), with the uncovered withdrawals it includes right below the figure. */
export function stripSections({
  t,
  fmt,
  a,
  report,
  actual,
}: {
  t: Translate;
  fmt: Fmt;
  a: Analysis;
  report: Report;
  actual: Report | null;
}): MetricSection[] {
  const windowed = a.openingValue !== null;
  const period = a.mwrPeriodDays !== null;
  const vs = actual ? report.gain - actual.gain : null;
  const dd = drawdownState(report.drawdown, a.today);
  // Same threshold as the core's `withdrawal_uncovered` warning.
  const uncovered = report.shortfall > 0.005 ? t('strip.uncovered', { amount: fmt.moneySigned(-report.shortfall) }) : undefined;
  return [
    {
      key: 'return',
      title: t('strip.return'),
      metrics: [
        { key: 'gain', label: t('strip.gain'), value: signed(fmt, report.gain) },
        {
          key: 'mwr',
          label: period ? t('strip.mwrPeriod') : t('strip.mwr'),
          info: period ? t('strip.info.mwrPeriod') : t('strip.info.mwr'),
          value: pct(fmt, report.irr),
        },
        ...(actual ? [{ key: 'vs', label: t('strip.vs'), info: t('strip.info.vs'), value: signed(fmt, vs), detail: uncovered }] : []),
      ],
    },
    {
      key: 'capital',
      title: t('strip.capital'),
      metrics: [
        { key: 'value', label: t('strip.value'), value: fmt.money(report.value) },
        {
          key: 'deposits',
          label: t('strip.deposits'),
          info: [
            windowed ? t('strip.info.depositsWindow', { value: fmt.money(a.openingValue ?? 0) }) : '',
            t('strip.info.bookings'),
          ].filter(Boolean).join(' '),
          detail: t('strip.bookings', { count: a.depositCount }),
          value: fmt.money(report.deposits),
        },
        {
          key: 'withdrawals',
          label: t('strip.withdrawals'),
          value: fmt.money(report.withdrawals),
          detail: t('strip.bookings', { count: a.withdrawalCount }),
        },
      ],
    },
    {
      key: 'risk',
      title: t('strip.risk'),
      metrics: [
        {
          key: 'maxDrawdown',
          label: t('strip.maxDrawdown'),
          info: [t('strip.info.maxDrawdown'), dd.kind === 'unavailable' ? t('strip.info.ddUnavailable') : ''].filter(Boolean).join(' '),
          value: dd.kind === 'unavailable' ? '–' : pct(fmt, dd.kind === 'none' ? 0 : dd.max),
          detail:
            dd.kind === 'unavailable'
              ? t('strip.ddUnavailable')
              : dd.kind === 'none'
                ? undefined
                : `${fmt.date(dd.peak)} – ${fmt.date(dd.trough)}`,
        },
        {
          key: 'recovery',
          label: t('strip.recovery'),
          info: t('strip.info.recovery'),
          // The duration is the figure (short enough for the mono value); the state reads below it.
          value: dd.kind === 'recovered' || dd.kind === 'open' ? durationText(t, fmt, dd.days) : '–',
          detail:
            dd.kind === 'recovered'
              ? t('strip.backOn', { date: fmt.date(dd.recovery) })
              : dd.kind === 'open'
                ? t('strip.notRecovered')
                : undefined,
        },
      ],
    },
  ];
}
