import { useIsMobile } from '@wealthfolio/ui';
import { useMemo } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { isError } from '../core/types';
import type { Analysis } from '../model/analysis';
import type { Fmt } from '../model/format';
import { axisTicks } from './axis';
import { rowName, useTexts } from './i18n';
import { HistoryChartMarkerShape } from '../vendor/wealthfolio/history-chart-marker';
import { bookingMarkers, dayFromTime, timeOfDay } from './markers';
import { thinRows, type ChartRow } from './thin';

interface Series {
  key: string;
  name: string;
  color: string;
  width: number;
  dash?: string;
}

export const NET_KEY = 'net';
export type ChartMode = 'value' | 'difference';
const DEPOSIT_COLOR = 'var(--success)';
const WITHDRAWAL_COLOR = 'var(--destructive)';
/** Points per line: about two pixels each, so years of daily values do not blur into a thick band. */
const LINE_POINTS = { desktop: 400, mobile: 150 };

/** Every computable row as a line in its badge colour (the host plots every added item); the selected line is
 * drawn last and thicker. Value mode plots the value with the dashed "Net in" reference; difference mode each gain
 * minus the real portfolio's, whose own line is then the zero line. */
export function ComparisonChart({
  a,
  fmt,
  colors,
  selected,
  markers,
  mode = 'value',
}: {
  a: Analysis;
  fmt: Fmt;
  colors: Map<string, string>;
  selected: string;
  /** Wealthfolio activity markers on the selected line. */
  markers: boolean;
  mode?: ChartMode;
}) {
  const { t, language } = useTexts();
  const isMobile = useIsMobile();

  const series = useMemo<Series[]>(() => {
    const out: Series[] =
      mode === 'value' ? [{ key: NET_KEY, name: t('chart.netDeposited'), color: 'var(--muted-foreground)', width: 1.5, dash: '5 4' }] : [];
    for (const r of a.rows) {
      const color = colors.get(r.key);
      if (isError(r.result) || !color) continue;
      out.push({ key: r.key, name: rowName(t, r), color, width: r.kind === 'actual' ? 2 : 1.5 });
    }
    const sel = out.findIndex((s) => s.key === selected);
    // >= 0: in Difference mode there is no net-in series, so the real portfolio is at index 0.
    if (sel >= 0) {
      const [s] = out.splice(sel, 1);
      out.push({ ...s, width: s.width + 0.5 });
    }
    return out;
  }, [a.rows, colors, selected, mode, t]);

  const chart = mode === 'difference' ? a.diffChart : a.chart;
  const data = useMemo(
    () => thinRows(
      chart.map((p): ChartRow => ({ ...p, time: timeOfDay(String(p.date)) })),
      series.map((s) => s.key),
      isMobile ? LINE_POINTS.mobile : LINE_POINTS.desktop,
      (row) => Number(row.depCount ?? 0) > 0 || Number(row.wdCount ?? 0) > 0,
    ),
    [chart, series, isMobile],
  );
  const points = useMemo(() => markers ? bookingMarkers(chart, selected) : [], [chart, selected, markers]);
  const dates = useMemo(() => a.chart.map((p) => String(p.date)), [a.chart]);
  const { ticks, label } = useMemo(() => axisTicks(dates, language), [dates, language]);
  const axis = { fontSize: 11, fill: 'var(--muted-foreground)' };
  // Legend in badge order (your portfolio, then the assets), the dashed reference last.
  const order = new Map(a.rows.map((r, i) => [r.key, i]));
  const legend = [...series].sort((x, y) => (order.get(x.key) ?? a.rows.length) - (order.get(y.key) ?? a.rows.length));

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div style={{ width: '100%', height: isMobile ? 280 : 380 }}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 16, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis
              dataKey="time"
              type="number"
              scale="time"
              domain={['dataMin', 'dataMax']}
              ticks={ticks.map(timeOfDay)}
              tickFormatter={(value: number) => label(dayFromTime(value))}
              tick={axis}
              tickLine={false}
              axisLine={{ stroke: 'var(--border)' }}
              interval="preserveStartEnd"
              minTickGap={isMobile ? 16 : 8}
            />
            {/* Host Recharts 3.7: no explicit scale="linear" (loses nice ticks), whole-unit ticks to match the money
                format, and width="auto" (a fixed width clips long amounts). */}
            <YAxis
              domain={['auto', 'auto']}
              padding={{ top: 16, bottom: 16 }}
              allowDecimals={false}
              tickFormatter={(v: number) => fmt.money(v)}
              tick={axis}
              tickLine={false}
              axisLine={false}
              width="auto"
            />
            {mode === 'difference' && <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeDasharray="5 4" strokeOpacity={0.6} ifOverflow="extendDomain" />}
            {/* filterNull off: a kept booking day without any line value still gets its tooltip. */}
            <Tooltip
              filterNull={false}
              cursor={{ stroke: 'var(--muted-foreground)', strokeWidth: 1 }}
              content={({ active, payload, label: day }) => {
                if (!active || !payload?.length) return null;
                // The exact day, not the thinned line: every series' value from the untouched row.
                const pt = (payload[0].payload as { full: Record<string, number | undefined> }).full;
                const rows = series.map((s) => ({ ...s, value: pt[s.key] })).sort((x, y) => Number(y.value ?? -Infinity) - Number(x.value ?? -Infinity));
                return (
                  <div className="bg-popover text-popover-foreground rounded-md border px-3 py-2 text-xs shadow-md">
                    <div className="text-muted-foreground mb-1">{fmt.date(dayFromTime(Number(day)))}</div>
                    {markers && !!(pt.depCount || pt.wdCount) && (
                      <div className="mb-1 space-y-0.5 border-b pb-1">
                        {pt.depCount ? (
                          <div className="flex items-center gap-2">
                            <span className="inline-block size-2 shrink-0 rounded-full" style={{ background: DEPOSIT_COLOR }} />
                            <span className="font-medium tabular-nums">{fmt.money(pt.depAmount ?? 0)}</span>
                            <span className="text-muted-foreground">{t('chart.deposit', { count: pt.depCount })}</span>
                          </div>
                        ) : null}
                        {pt.wdCount ? (
                          <div className="flex items-center gap-2">
                            <span className="inline-block size-2 shrink-0 rounded-full" style={{ background: WITHDRAWAL_COLOR }} />
                            <span className="font-medium tabular-nums">{fmt.money(pt.wdAmount ?? 0)}</span>
                            <span className="text-muted-foreground">{t('chart.withdrawal', { count: pt.wdCount })}</span>
                          </div>
                        ) : null}
                      </div>
                    )}
                    <div className="space-y-1">
                      {rows.map((p) => (
                        <div key={p.key} className="flex items-center gap-2">
                          <span className="inline-block h-0.5 w-3 shrink-0" style={{ background: p.color }} />
                          <span className="font-medium tabular-nums">
                            {typeof p.value !== 'number' ? '–' : mode === 'difference' ? fmt.moneySigned(p.value) : fmt.money(p.value)}
                          </span>
                          <span className="text-muted-foreground">{p.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              }}
            />
            {series.map((s) => (
              <Line
                key={s.key}
                dataKey={s.key}
                name={s.name}
                stroke={s.color}
                strokeWidth={s.width}
                strokeDasharray={s.dash}
                strokeLinecap="round"
                dot={false}
                activeDot={{ r: 4, stroke: 'var(--card)', strokeWidth: 2 }}
                connectNulls
                isAnimationActive={false}
              />
            ))}
            {points.map((point) => (
              <ReferenceDot
                key={point.date}
                x={timeOfDay(point.date)}
                y={point.value}
                shape={(props) => <HistoryChartMarkerShape {...props} variant="activity" label={point.label} tone={point.tone} />}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ul className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs" aria-label={t('chart.legend')}>
        {legend.map((s) => (
          <li key={s.key} className="text-muted-foreground flex items-center gap-1.5">
            {s.dash ? (
              <span className="inline-block w-3 border-t-[1.5px] border-dashed" style={{ borderColor: s.color }} />
            ) : (
              <span className="inline-block size-2 rounded-[2px]" style={{ background: s.color }} />
            )}
            <span className={s.key === selected ? 'text-foreground font-medium' : undefined}>{s.name}</span>
          </li>
        ))}
        {markers && (
          <>
            <li className="text-muted-foreground flex items-center gap-1.5">
              <span className="inline-block size-2 rounded-full" style={{ background: DEPOSIT_COLOR }} />
              {t('chart.deposits')}
            </li>
            <li className="text-muted-foreground flex items-center gap-1.5">
              <span className="inline-block size-2 rounded-full" style={{ background: WITHDRAWAL_COLOR }} />
              {t('chart.withdrawals')}
            </li>
          </>
        )}
      </ul>
    </div>
  );
}
