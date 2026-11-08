# Hindsight

A Wealthfolio addon for one question: **would a simpler strategy have done better with your money?**
Hindsight replays your own deposits and withdrawals in an alternative, such as an index ETF, Bitcoin,
any Yahoo Finance ticker, cash or a fixed mix (e.g. 70/30 with yearly rebalancing): each deposit buys it
on the same day, each withdrawal sells some of it. It then shows how much more or less you would have
gained.

- **Gain difference:** the alternative's gain minus yours, with exactly your cash flows.
- **MWR p.a.:** the same comparison as a money-weighted yearly return (XIRR).
- **Charts:** each line's value next to the money taken in, or each alternative's lead or gap over your
  portfolio over time, with deposit/withdrawal markers.
- **Max drawdown:** how far each line fell from a high (time-weighted), i.e. how bumpy the ride was.
- **Nominal or real:** gain and MWR in purchasing power at the end of the period.
- Select accounts, alternatives and a date range; follows Wealthfolio's language and number formatting
  (English and German included).

## Install

Requires Wealthfolio **3.12.0 or later**; tested with the 3.12.0 SDK and host chart dependencies.
Compatibility with later host releases must be checked when upgrading.

Build the ZIP locally (Node.js 22.12+ and Python 3.12+):

```sh
npm ci --ignore-scripts
npm run check
npm run package
```

Upload `build/hindsight.zip` in Wealthfolio under **Settings → Add-ons** and approve its
listed read permissions and network hosts. Open **Hindsight** in the sidebar.

## Data and privacy

Hindsight reads selected accounts, activities and valuations through the Wealthfolio SDK.
It does not change holdings or transactions. It stores selections and cached market data
in Wealthfolio's addon storage. There is no addon backend or telemetry.

Network requests use Wealthfolio's network broker and are restricted to Yahoo Finance
(`query1.finance.yahoo.com`, prices and currency rates) and OECD (`sdmx.oecd.org`, consumer
price indices). Public-data queries contain tickers, date ranges, currency pairs and a
country code; account identifiers and transaction amounts are not sent to those services.

## Method and limits

Hindsight is a Public Market Equivalent (PME) in the Long–Nickels sense (index comparison
method) applied to your own portfolio: each alternative receives the same cash flows as the
selected portfolio, every deposit buys it and every withdrawal sells some of it. Unlike the
textbook method, its position never goes negative; a withdrawal it cannot cover is not counted
and is flagged. Internal transfers
within the selection are excluded. Prices use adjusted daily closes; inflation uses monthly
OECD CPI inferred from Wealthfolio's time zone or base currency. Missing data and withdrawals
an alternative cannot cover are shown as warnings. This is a historical comparison before
taxes and hypothetical trading costs, not a forecast. Actual valuations retain any costs
already reflected in Wealthfolio.

See [the calculation model](docs/MODEL.md) for assumptions and edge cases, and
[development notes](docs/DEVELOPMENT.md) for architecture, synthetic tests and the independent
Python reference model.

## Development

```sh
npm ci --ignore-scripts
npm run check
npm run package
```

Only synthetic test fixtures belong in this repository. Bug reports should include the
Wealthfolio version, addon version and synthetic reproduction, with personal data removed.
See [CONTRIBUTING.md](CONTRIBUTING.md) and [CHANGELOG.md](CHANGELOG.md).

## License

Original Hindsight code is MIT-licensed. The vendored Wealthfolio chart marker is
AGPL-3.0-only; the combined addon is distributed subject to that license as well.
See [LICENSE](LICENSE), [the AGPL text](LICENSES/AGPL-3.0-only.txt) and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The ZIP includes these notices,
licenses for bundled dependencies and the matching Hindsight source archive.
