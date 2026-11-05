import type { HistoryChartMarkerTone } from '../vendor/wealthfolio/history-chart-marker';

export const timeOfDay = (day: string): number => Date.parse(`${day}T00:00:00Z`);
export const dayFromTime = (time: number): string => new Date(time).toISOString().slice(0, 10);

export interface BookingMarker {
  date: string;
  value: number;
  label: string;
  tone: HistoryChartMarkerTone;
}

/** Same type labels and mixed-day rule as Wealthfolio's account page. */
export function bookingMarkers(chart: Record<string, number | string | null>[], selected: string): BookingMarker[] {
  return chart.flatMap((point) => {
    const deposit = Number(point.depCount ?? 0) > 0;
    const withdrawal = Number(point.wdCount ?? 0) > 0;
    if (!deposit && !withdrawal) return [];
    // Before the first valuation/quote the selected line can be empty; the net-in reference still exists.
    const value = typeof point[selected] === 'number' ? point[selected] : point.net;
    if (typeof value !== 'number' || !Number.isFinite(value)) return [];
    return [{
      date: String(point.date),
      value,
      label: deposit && withdrawal ? '2' : deposit ? 'D' : 'W',
      tone: deposit && withdrawal ? 'default' : deposit ? 'success' : 'destructive',
    }];
  });
}
