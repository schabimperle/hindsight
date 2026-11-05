# Hindsight

A Wealthfolio addon that answers: **what would your portfolio be worth if every deposit
had bought a single asset instead?** Replay the same deposits and withdrawals in an ETF,
Bitcoin, another Yahoo Finance ticker, or cash, and compare the result with your portfolio.

- Select accounts, benchmarks and a date range.
- Compare value, gain and money-weighted return, nominal or inflation-adjusted.
- Switch between linear and logarithmic charts and show deposit/withdrawal markers.
- Follows Wealthfolio's language and number formatting; English and German are included.

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

Each alternative receives the same cash flows as the selected portfolio. Internal transfers
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
