# Changelog

## Unreleased

- Fixed mixes as alternatives: “Create a mix…” in “Add benchmark” combines 2 to 5 assets with weights, rebalanced
  yearly (on the first trading day) or never. Deposits split by the weights, withdrawals sell pro rata; the mix
  gets its line, row, metrics and drawdown like any alternative.

- Maximum drawdown and recovery time per line, time-weighted so deposits and withdrawals do not count: a new
  “Risk” section in the metrics and a “Max drawdown” column in the comparison. Alternatives use their price,
  your portfolio Wealthfolio's daily valuations (with Wealthfolio's own day convention).

- A third chart mode, “Difference”, shows each alternative's gain minus yours over time: your portfolio is the
  zero line, and the end point is the gain difference in the table. It shows when a lead or gap arose and whether
  it held.

- The chart shows the gain so far by default (value minus each line's own executed flows); the value chart,
  with the logarithmic scale, is one switch away.
- One line under the title states the idea (same cash flows, different investments); the period sits where
  Wealthfolio's Performance card shows its date range (right of the title, below it beside the metrics and on
  phones). The info dialog names the method (Public Market Equivalent, Long–Nickels) and drops its extra heading.
- The scale switch sits left of the Gain/Value switch; the real-view note is an info button next to the
  Nominal/Real switch.
- “vs. yours” is now “Gain difference”, with an explanation at the table column; for an alternative that could
  not cover a withdrawal, the metric strip shows the uncovered amount the difference includes. Switching the table
  to real figures explains that the end value stays the same.
- “All accounts” is now “All investment accounts”. Account eligibility follows Wealthfolio's Performance rule, so
  credit cards and archived accounts are excluded; stale selections are shown as unavailable and block the analysis
  until removed. A changed account scope no longer shows the previous accounts' results while loading.

## 0.3.0

- Standalone Hindsight repository extracted from its former connector project.
- Portfolio comparison with selectable accounts, benchmarks and date ranges.
- Nominal and inflation-adjusted results, linear/logarithmic charts and flow markers.
- English and German UI, synthetic test suite and independent Python oracle.
- Reproducible installable ZIP with licenses, bundled dependency notices and source archive.

The addon ID, stored settings and calculation behavior remain compatible with the previous
0.3.0 build. Packaged versions include a content hash to distinguish builds.
