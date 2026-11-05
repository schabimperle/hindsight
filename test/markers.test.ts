import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { bookingMarkers, dayFromTime, timeOfDay } from '../src/ui/markers';
import { HistoryChartMarkerShape } from '../src/vendor/wealthfolio/history-chart-marker';

describe('Wealthfolio account activity markers', () => {
  it('labels deposits D, withdrawals W, mixed days by type count, and omits empty days', () => {
    const markers = bookingMarkers([
      { date: '2024-01-01', actual: 1000, depCount: 2 },
      { date: '2024-01-02', actual: 900, wdCount: 1 },
      { date: '2024-01-03', actual: 900, depCount: 1, wdCount: 1 },
      { date: '2024-01-04', actual: 900 },
    ], 'actual');
    expect(markers.map(({ label, tone }) => ({ label, tone }))).toEqual([
      { label: 'D', tone: 'success' }, { label: 'W', tone: 'destructive' }, { label: '2', tone: 'default' },
    ]);
    const markup = renderToStaticMarkup(createElement(HistoryChartMarkerShape, {
      variant: 'activity', cx: 10, cy: 20, ...markers[0],
    }));
    expect(markup).toContain('>D</text>');
    expect(markup).toContain('var(--success)');
    expect(markup).toContain('r="12"');
    expect(markup).toContain('r="8"');
  });

  it('uses net-in when the selected line has no valuation on a booking day', () => {
    expect(bookingMarkers([{ date: '2024-01-01', actual: null, net: 100, depCount: 1 }], 'actual')[0].value).toBe(100);
    expect(bookingMarkers([{ date: '2024-01-01', actual: 0, net: 100, depCount: 1 }], 'actual')[0].value).toBe(0);
  });

  it('preserves elapsed time on the numeric axis (also across daylight saving time)', () => {
    expect(timeOfDay('2024-04-01') - timeOfDay('2024-03-31')).toBe(86400000);
    expect(timeOfDay('2024-04-10') - timeOfDay('2024-03-31')).toBe(10 * 86400000);
    expect(dayFromTime(timeOfDay('2024-03-31'))).toBe('2024-03-31');
  });
});
