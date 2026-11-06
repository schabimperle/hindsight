import type { Report } from '../core/types';
import type { Analysis } from '../model/analysis';
import type { Fmt } from '../model/format';
import type { Translate } from '../model/messages';
import type { MetricSection } from './MetricStrip';
import { gainClass } from './styles';

const signed = (fmt: Fmt, v: number | null) => <span className={gainClass(v)}>{v === null ? '–' : fmt.moneySigned(v)}</span>;
const pct = (fmt: Fmt, v: number | null) => <span className={gainClass(v)}>{fmt.pctSigned(v)}</span>;

/** Metrics of the selected item in the host's strip layout: return and capital (nominal; the real figures are in
 * the comparison table below); "vs. yours" only for
 * an alternative (`actual` = the real portfolio's report to compare with). */
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
        ...(actual ? [{ key: 'vs', label: t('strip.vs'), info: t('strip.info.vs'), value: signed(fmt, vs) }] : []),
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
  ];
}
