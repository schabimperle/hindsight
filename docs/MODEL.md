# Calculation model


- Cash flows (`src/core/flows.ts`): `DEPOSIT`/`WITHDRAWAL` and transfers. A transfer is internal (does not
  count) exactly when a counterpart with the same `sourceGroupId` lies in the selected accounts;
  `metadata.flow.is_external` is deliberately not read (false is only the SDK default). Ungrouped pairs
  between selected accounts are only reported, not guessed. In-kind transfers: the booking's `unitPrice` x
  quantity (so for hand-entered bookings whatever was entered there, e.g. an old purchase price), otherwise
  the nearest Wealthfolio price to the booking day (before or after, at most 10 days); without a value the
  analysis is blocked and lists the bookings. Exception “worthless” (`worthless` in `src/sources/load.ts`):
  no value today (`heldValue`) in the selected accounts and never a Wealthfolio price > 0 (spam token) ->
  the transfer is ignored, but counted. Consequence: if such an asset is sold after all, the proceeds show
  up as gain of the real portfolio (the sale is not a flow). Foreign-currency deposits/withdrawals and cash
  transfers without an exchange rate also block with a booking list (leaving them out would distort the
  comparison).
- Simulation (`reference/oracle.py`): flows are netted per day; a purchase happens at the adjusted close of
  the day or the next trading day (at most 10 days); if there is no later price (flow on today's Saturday, US
  ticker before the market opens), at the last price before it if at most 10 days old (the same limit as for
  today's price); before the first price the money stays cash and is invested on the first price day;
  uncovered withdrawals only count up to the covered amount (gain and XIRR use the executed flows).
  “vs. your portfolio” = difference in gain; without an uncovered withdrawal it equals the difference in value.
- Period (`src/model/range.ts`, `analyze(input, window)`): a start after the first flow makes the real
  portfolio's value at the end of the start day (Wealthfolio's daily valuations, latest on or before the day,
  at most 10 days old, never negative, else the analysis blocks with `valuation_missing`) an opening deposit on
  that day; flows up to that day are dropped. Alternatives buy it at the last price on or before the start
  day (the real value is a close as well; a Sunday start uses Friday), else like any deposit. A custom end
  before today uses the valuation of that day and drops later flows and prices. Money-weighted returns (XIRR)
  are per year from a 365-day window on, below that over the window itself (`mwrPeriodDays`, label “MWR”
  without “p.a.”), as on the host's Performance page. Loading does not depend on the period: switching only
  recomputes. Chart points: daily up to ~13 months, weekly up to ~6 years, month ends beyond.
- Currencies: any base currency. Prices in the ticker currency (`GBp`, `ZAc`, `ILA` into the main currency)
  are converted via Yahoo pairs `<CCY><BASE>=X` (rate on or before the day, `src/sources/fx.ts`), as are
  foreign-currency bookings without a usable `fxRate` and Wealthfolio prices in a foreign currency.
- Inflation: OECD CPI (SDMX-CSV, `src/sources/oecd.ts`). Since 2026 most European countries publish their
  current months only in the COICOP 2018 dataflow, others (DEU, USA) only in the old one: both are read and
  the most recent series wins; if one fails (other than 404), the other counts and the result is not cached.
  A month missing inside the series (USA 2025-10) takes the value of the last published month before it
  (header warning `inflation_gap` with the months a flow falls into); a flow before the first month
  (Australia: only from 2024-04) -> no real figures, warning with country and month. The country list is fixed
  in `src/model/countries.ts` (lag at build time at most 12 months); the country always comes from the
  Wealthfolio time zone, else the base currency (no setting since 11/2026). Real figures use the CPI of the
  period's end month as “now”; CPI is monthly, so over short periods real figures are coarse.
- Caches in the addon storage: `yahoo:v2:<ticker>` 12 h, `oecd:v1:<country>` 24 h; on a network error it falls
  back with a warning, but only to an entry that covers the required start (otherwise a series that is too
  short would look like a late start).
- Settings, each saved immediately by its selector (no settings sheet): `settings:accounts` (account scope;
  null = all active non-cash accounts), `settings:benchmarks` (`{name, ticker, kind}`, added with “Add
  benchmark”, removed with the badge's X; old entries with `taxClass` are still read), `settings:range`
  (`{preset}` or `{from, to}`). `settings:inflation` and old tax keys are ignored.
- UI (`src/ui/`) mirrors Insights > Performance of Wealthfolio 3.12: account scope selector and
  `DateRangeSelector` in a right-aligned row at the content padding (not `PageHeader`: its padding and empty
  title slot pushed the row inwards on phones), badge row with “Add benchmark” (badge click selects, X removes),
  card with the host's metric strip (nominal only: gain, MWR, vs. yours; value, deposits, withdrawals; original booking counts in the deposit/withdrawal tiles; help popover; info button per tile on phones) and the chart with every
  computable asset in the host's `--series-1…8` colours, cycled. The host components themselves are not
  exported to addons (`AccountScopeSelector`, `BenchmarkSymbolSelector`, the strip), so `AccountScope.tsx`,
  `BenchmarkPicker.tsx`, `Badges.tsx` and `MetricStrip.tsx` are clones with the host's classes.
  The comparison table below switches gain, MWR and "vs. yours" between nominal and real; the strip stays
  nominal. Real amounts use end-period purchasing power: the end value stays unchanged, earlier payments
  are multiplied by CPI(end)/CPI(payment). Thus the gain gap also stays unchanged with identical executed
  payments, but can change with uncovered withdrawals. A row click selects the line (strip and chart), a row with notes (uncovered withdrawal, late start)
  has a warning button that opens them; there is no other detail row (everything else is in the strip).
  `Report.deposits`/`withdrawals` are the executed flows (netted per day) behind `invested`. The chart's
  round History button toggles the account detail chart's original `HistoryChartMarkerShape` via Recharts
  `ReferenceDot` (vendored unchanged because the SDK does not export it; provenance and license in
  `src/vendor/wealthfolio/`). D = deposit (green), W = withdrawal (red), 2 = both types on the same day,
  as on the host. Booking dates are merged into sampled chart days and simulated paths, with a numeric UTC
  time axis so unequal intervals stay proportional. Recharts automatically fits and rounds the Y-axis to
  the visible series (including net-in), with 16 px vertical padding; it does not force a zero baseline.
  Y ticks are whole currency units (`allowDecimals={false}`), formatted like the other amounts; compact
  notation collapsed adjacent ticks in narrow windows. Keep `scale="auto"`: the host's Recharts 3.7
  skips nice/whole-unit ticks with explicit `scale="linear"`. `width="auto"` measures the labels on each
  range change: a fixed mobile width clipped German six-digit amounts and negative signs. Do not restore
  a fixed width or compact tick labels.
  A shared pill control (same component as Nominal/Real) at the top right switches Linear/Logarithmic.
  Linear remains the default. Log uses Recharts `scale="log"`, the positive data extent (constant values
  get a nondegenerate domain), and D3 log ticks with distinct whole-currency labels. It keeps the same
  16 px padding and automatic label width; it does not round the domain to powers of ten, which would
  flatten short windows. Log is disabled, with a visible explanation, if any plotted value is zero,
  negative or nonfinite, including the always-visible net-in reference. Existing null gaps do not block
  it. No values are hidden or clamped. The choice is local like Nominal/Real and History; an unavailable
  range displays Linear and restores the chosen Log mode when positive data returns.
  Missing selected-line values use the net-in reference.
  `depCount`/`depAmount`/`wdCount`/`wdAmount` describe original bookings on that day, not simulated execution.
  Tile counts also mean original bookings (excluding the opening value); the help explains daily netting
  and uncovered withdrawals. Badge minimum height is inline because the host CSS does not contain addon-only
  Tailwind utilities. Mobile metric tiles use the host's label/value typography, padding and gaps, with its compact
  16 px info trigger. Their backgrounds stretch to the carousel row's height (`h-full`); do not reserve
  label/detail space or use the general 44 px touch info button here, which inflates the mobile strip.
  Explanations stay short on purpose: only what is not obvious from the label (MWR, the opening value, the two
  warnings, the assumptions dialog).
