/** Text colour as for Wealthfolio gains and losses. */
export const gainClass = (v: number | null): string => {
  if (v === null || Math.abs(v) < 0.0005) return 'text-muted-foreground';
  return v > 0 ? 'text-success' : 'text-destructive';
};

/** The host's chart series colours (theme variables, as Insights > Performance uses them). */
const SERIES = ['--series-1', '--series-2', '--series-3', '--series-4', '--series-5', '--series-6', '--series-7', '--series-8'];

/** Colour of the n-th comparison asset; cycles through the host palette like the Performance page does. */
export const seriesColor = (n: number): string => `var(${SERIES[n % SERIES.length]})`;
