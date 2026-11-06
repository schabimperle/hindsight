# Development

Run commands from the repository root. Node.js 22.12+ and Python 3.12+ are required.

## Oracle

`../reference/oracle.py` is the authoritative reference of the calculation logic. `../src/core/` is a 1:1 port;
`../test/golden.test.ts` compares it with `../test/fixtures/synthetic*.expected.json`. To regenerate fixtures and
expectations:

    python3 -I reference/make_fixture.py main > test/fixtures/synthetic.json
    python3 -I reference/make_fixture.py edge > test/fixtures/synthetic-edge.json
    python3 -I reference/make_fixture.py window > test/fixtures/synthetic-window.json
    python3 -I reference/make_fixture.py short > test/fixtures/synthetic-short.json
    python3 -I reference/make_fixture.py mix > test/fixtures/synthetic-mix.json
    python3 -I reference/oracle.py test/fixtures/synthetic.json > test/fixtures/synthetic.expected.json
    python3 -I reference/oracle.py test/fixtures/synthetic-edge.json > test/fixtures/synthetic-edge.expected.json
    python3 -I reference/oracle.py test/fixtures/synthetic-window.json > test/fixtures/synthetic-window.expected.json
    python3 -I reference/oracle.py test/fixtures/synthetic-short.json > test/fixtures/synthetic-short.expected.json
    python3 -I reference/oracle.py test/fixtures/synthetic-mix.json > test/fixtures/synthetic-mix.expected.json

Tolerances: money +-0.01, rates +-1e-6.
Compare against arbitrary fixtures:

    npm run compare -- <fixture.json> <expected.json>

If the oracle disagrees, the oracle is changed deliberately and then the TypeScript core, never the other way
round.

## Build and test

The Recharts dev dependency is pinned to 3.7.0 to match Wealthfolio 3.12's runtime (see the host's
`pnpm-lock.yaml`). A newer dev version hid differences in axis scale/tick handling; testing the host
version is intentional, since Recharts is external and is never bundled into the addon.

    npm ci
    npm run typecheck
    npm test
    npm run build      # dist/addon.js
    npm run package    # build/hindsight.zip

`npm run package` writes `manifest.json` with the version `<version>+<first 12 hex of the SHA-256 over
all payload filenames and contents plus the manifest without its version>` and puts `dist/**` into the ZIP reproducibly (fixed timestamps, sorted
entries). Upload the ZIP in Wealthfolio under Settings > Add-ons.

## Structure

- `../src/core/` pure calculation functions without SDK imports (series, simulation, XIRR, cash flows, currency units)
- `../src/sources/` data layer (Wealthfolio host API, Yahoo, exchange rates, OECD, cache, settings)
- `../src/model/` merging, countries, formats, message codes -> i18n keys
- `../src/i18n/` texts (`en.json` base, `de.json`); core and model only deliver codes and parameters
- `../src/ui/` React UI (`@wealthfolio/ui`, recharts, React Query from the host); no hard-coded texts
  (`../test/i18n.test.ts` checks this roughly)

## Testing in a real Wealthfolio (non-obvious)

- Throw-away instance: image `wealthfolio/wealthfolio:<version>` with `WF_AUTH_REQUIRED=false`, bound to
  `127.0.0.1` only, data directory writable for UID 1000; install the addon with
  `POST /api/v1/addons/install-zip` (`zipDataB64`, `enableAfterInstall`, `approvedNetworkHosts`).
  Set settings with `PUT /api/v1/addons/storage/hindsight/<key>` and `{"value": "<json>"}`.
- The addon runs in a `srcdoc` iframe with its own scroll: `full_page` screenshots only show the viewport, so
  take them with a tall viewport (e.g. 390x3200); read text through `page.frames`.
- Inside the iframe only the host's compiled Tailwind (`/app/dist/assets/main-*.css`) applies: look up every
  utility class there (the file is a single line); if e.g. `text-left`/`text-right`/`ml-auto` are missing, use
  `text-start`/`text-end`/`ms-auto`.
- Wealthfolio 3.12 needs `WF_SECRET_KEY` even for the throw-away instance; create synthetic data via
  `POST /api/v1/accounts`, `POST /api/v1/activities/bulk` (`{"creates": [...]}`), and set the host language via
  `PUT /api/v1/settings` (`{"language": "de"}`). In a dev container Chromium may lack five libraries (libatk,
  libatk-bridge, libatspi, libXcomposite, libXdamage): unpack them from the Debian packages and add them via
  `LD_LIBRARY_PATH`; address the addon content through `page.frame_locator('iframe')`.
- Runtime differs from the SDK types: `portfolio.getHoldings` returns `lots: null` (lots only via `getHolding`
  per position, with `acquisitionLocalDate`), `activities.search` rows carry `sourceGroupId`,
  `market.searchTicker` returns `quoteMode` and, for assets that already exist, no provider fields (`symbol`
  is then the Yahoo symbol).
- The permission category for `ctx.api.market.*` is `market-data` (not `market`); `validateManifest` does not
  flag a wrong category, and without it `searchTicker` fails silently.
- Storage keys only allow letters, digits and `_ . : -` (`USDEUR=X` -> `storageKey` in `../src/sources/http.ts`).
- Yahoo answers 429 through the network broker without a browser User-Agent.
- The sandbox wraps the addon in the host's `FormattingProvider` (locale and per-currency regions from Settings),
  so `AmountDisplay` and `useLocalizationSettings`/`useAmountFormatting` follow the host's number format; `useFmt`
  uses them. Balance privacy does not reach the addon: the iframe has an opaque origin (no `localStorage`) and the
  host forwards no privacy state, so `useBalancePrivacy` always reports “visible”.


CI regenerates all four synthetic fixtures and their Python-oracle expectations, and
fails if they differ from the checked-in files. Never use real account data in fixtures.

The installable ZIP also includes license notices and a source archive under `dist/`.
Its content hash covers every payload file and the manifest, excluding the version.
`npm run package` rebuilds first, so stale output cannot become a release.
