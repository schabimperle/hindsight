# Calculation model

`reference/oracle.py` is the reference implementation; `src/core/` ports it and is tested against it.

## Cash flows

- Deposits, withdrawals and transfers count when they cross the boundary of the selected accounts. A
  transfer is internal when its counterpart (same `sourceGroupId`) is selected. Unlinked transfers between
  selected accounts count as external and are flagged.
- Asset transfers count at the booking's unit price × quantity, else at the nearest Wealthfolio price within
  10 days. Without a value the analysis stops and lists the bookings.
- Worthless asset transfers (no value now, never a positive price, e.g. spam tokens) are ignored. If such an
  asset is sold later, the proceeds show up as gain of your portfolio.
- Foreign-currency bookings without an exchange rate stop the analysis.

## Simulation

- Flows are netted per day. A deposit buys at the adjusted close of its day or the next trading day (within
  10 days); if there is no later price yet, at the last price up to 10 days old.
- Before an asset's first price the money stays cash and is invested on that day.
- The position never goes negative: a withdrawal counts only up to the alternative's value. Gain and return
  use the executed flows.
- Gain difference = alternative's gain − your gain. Without uncovered withdrawals it equals the difference in
  end values.

## Mixes

- 2–5 assets with weights in percent (up to two decimals, sum 100).
- Deposits split by weight; withdrawals sell pro rata to current values.
- Rebalancing only happens on days on which every started asset has a price, so no pending purchase is valued
  at an old price.
  - Monthly, quarterly, yearly: the first such day of each period.
  - Threshold: any such day on which a share is more than the threshold (percentage points, default 5) off
    its weight.
  - Never: the weights drift.
- A mix is identified by `mix:<TICKER*weight, sorted>|<rule>[:<threshold>]`, so equal compositions are the
  same mix.

## Returns

- Money-weighted return (MWR) is the XIRR, annualised from 365 days on, otherwise over the period.
- XIRR searches −99 %…+1000 % and widens to −99.99 %…+1,000,000 % only if needed; beyond that it shows “–”.

## Max drawdown

- Measured on a time-weighted index and always nominal.
- Alternatives: the asset's price from the first purchase on, i.e. the asset's risk, not the position's.
  Cash never falls. Mixes: the strategy with one unit invested at the first deposit.
- Your portfolio: Wealthfolio's daily valuations chained with the original bookings (deposits at the start
  of the day, withdrawals at its end), as on Wealthfolio's Performance page. Unavailable if a booking falls on
  a day without a valuation of every selected account.

## Periods

- A start after the first flow turns your portfolio's value on the start day into an opening deposit (latest
  valuation at most 10 days old). Alternatives buy it at the last price on or before that day.
- A custom end uses that day's valuation and ignores later flows and prices.
- Changing the period recalculates without reloading data.

## Currencies

Any base currency. Prices in minor units (`GBp`, `ZAc`, `ILA`) are converted to the main unit, foreign
currencies via Yahoo pairs `<CCY><BASE>=X` at the rate on or before the day.

## Inflation

- Monthly OECD consumer price index, from the COICOP 2018 and the older dataflow; the more recent wins.
- A missing month takes the last published value before it. If a flow predates the series, there are no
  real figures.
- The country follows Wealthfolio's time zone, else the base currency (`src/model/countries.ts`).
- Real amounts keep the end value and scale earlier flows by CPI(end) / CPI(flow), so the gain difference
  stays the same unless a withdrawal was uncovered.

## Accounts

- Eligible as on Wealthfolio's Performance page: not archived; securities, cash or crypto accounts.
- “All investment accounts” takes the active, non-cash ones.
- A stored account that is no longer available blocks the analysis until it is deselected.

## Storage

- Settings: `settings:accounts` (`null` = all investment accounts), `settings:benchmarks`, `settings:range`.
- Cache: `yahoo:v2:<ticker>` for 12 h, `oecd:v1:<country>` for 24 h. After a network error, a cached series
  is used only if it covers the required start.
