import type { Report } from '../core/types';
import type { Analysis } from '../model/analysis';
import type { Fmt } from '../model/format';
import type { Translate } from '../model/messages';
import type { MetricSection } from './MetricStrip';
import { gainClass } from './styles';

const signed = (fmt: Fmt, v: number | null) => <span className={gainClass(v)}>{v === null ? '–' : fmt.moneySigned(v)}</span>;
const pct = (fmt: Fmt, v: number | null) => <span className={gainClass(v)}>{fmt.pctSigned(v)}</span>;

/** Metrics of the selected item in the host's strip layout: return and capital (nominal; the real figures are in
 * the comparison table below; a period after the first deposit splits the start value from the deposits, as
 * Value = Start value + Deposits - Withdrawals + Gain); for an alternative the gain difference first, as the answer to the comparison
 * (`actual` = the real portfolio's report to compare with), with the uncovered withdrawals it includes right below
 * the figure. The max drawdown is a column of the comparison table only. */
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
  const opening = a.openingValue;
  const period = a.mwrPeriodDays !== null;
  const vs = actual ? report.gain - actual.gain : null;
  // Same threshold as the core's `withdrawal_uncovered` warning.
  const uncovered = report.shortfall > 0.005 ? t('strip.uncovered', { amount: fmt.moneySigned(-report.shortfall) }) : undefined;
  return [
    {
      key: 'return',
      title: t('strip.return'),
      metrics: [
        ...(actual ? [{ key: 'vs', label: t('strip.vs'), info: t('strip.info.vs'), value: signed(fmt, vs), detail: uncovered }] : []),
        { key: 'gain', label: t('strip.gain'), value: signed(fmt, report.gain) },
        {
          key: 'mwr',
          label: period ? t('strip.mwrPeriod') : t('strip.mwr'),
          info: period ? t('strip.info.mwrPeriod') : t('strip.info.mwr'),
          value: pct(fmt, report.irr),
        },
      ],
    },
    {
      key: 'capital',
      title: t('strip.capital'),
      metrics: [
        { key: 'value', label: t('strip.value'), value: fmt.money(report.value) },
        ...(opening !== null
          ? [
              {
                key: 'start',
                label: t('strip.start'),
                info: t('strip.info.start'),
                value: fmt.money(opening),
                detail: a.start ? fmt.date(a.start) : undefined,
              },
            ]
          : []),
        {
          key: 'deposits',
          label: t('strip.deposits'),
          info: t('strip.info.bookings'),
          detail: t('strip.bookings', { count: a.depositCount }),
          // The core books the start value as a deposit on the start day (no booking shares that day), shown apart.
          value: fmt.money(Math.max(0, report.deposits - (opening ?? 0))),
        },
        {
          key: 'withdrawals',
          label: t('strip.withdrawals'),
          value: fmt.money(report.withdrawals),
          detail: t('strip.bookings', { count: a.withdrawalCount }),
        },
      ],
    },
  ];
}
