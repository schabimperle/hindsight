/** Text colour as for Wealthfolio gains and losses. */
export const gainClass = (v: number | null): string => {
  if (v === null || Math.abs(v) < 0.0005) return 'text-muted-foreground';
  return v > 0 ? 'text-success' : 'text-destructive';
};

/** Layout size and 44px touch target are owned by compact.css, independently of host Tailwind versions. */
export const COMPACT_ICON_BUTTON = 'hindsight-compact-icon';

/** The host's chart series colours (theme variables, as Insights > Performance uses them). */
const SERIES = ['--series-1', '--series-2', '--series-3', '--series-4', '--series-5', '--series-6', '--series-7', '--series-8'];

/** Colour of the n-th comparison asset; cycles through the host palette like the Performance page does. */
export const seriesColor = (n: number): string => `var(${SERIES[n % SERIES.length]})`;

/**
 * Size of a scrolling dialog. On phones `DialogContent` renders a bottom sheet whose root is a plain block, so
 * the `gap-4` that spaces the desktop dialog's children does nothing there; `grid`, as on the desktop, restores
 * it. Not `flex flex-col`: when the content outgrows the sheet, flex items shrink, and the host's mobile `.flex`
 * reset (`overflow-x: clip`) removes the dialog header's content-based minimum height, so it collapses to zero
 * and its text overlaps the sections below. Grid rows keep their content height and the sheet scrolls.
 */
export const DIALOG = {
  className: 'max-h-[85vh] overflow-y-auto sm:max-w-lg',
  mobileClassName: 'grid max-h-[85vh] overflow-y-auto p-6',
};
