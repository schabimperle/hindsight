# Changelog

## Unreleased

- The chart shows the gain so far by default (value minus each line's own executed flows); the value chart,
  with the logarithmic scale, is one switch away.
- One line under the title states the idea: same cash flows, different investments.
- “vs. yours” is now “Gain vs. yours” with a short explanation; switching the table to real figures explains that
  the end value stays the same.
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
