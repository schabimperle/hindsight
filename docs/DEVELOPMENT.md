# Development

## Layout

| Path | Contents |
| --- | --- |
| `src/core/` | Pure calculations, no SDK imports |
| `src/sources/` | Wealthfolio API, Yahoo, OECD, cache, settings |
| `src/model/` | Merging, formats, message codes |
| `src/ui/` | React UI on the host's components; no hard-coded text |
| `src/i18n/` | `en.json` (base), `de.json` |
| `reference/` | Python reference model and fixture generator |

## Reference model

`npm run check` regenerates the synthetic fixtures with `reference/make_fixture.py`, recomputes them with
`reference/oracle.py` and fails if either differs from `test/fixtures/`. Tolerances: money ±0.01, rates
±1e-6. After an intended model change, `npm run fixtures` rewrites them. To compare any fixture:

```sh
npm run compare -- <fixture.json> <expected.json>
```

## Packaging

`npm run package` rebuilds and writes `build/hindsight.zip` reproducibly. The manifest version gets a
content hash, e.g. `0.4.0+1a2b3c4d5e6f`, so every build is distinguishable.

## Host quirks

- Recharts is provided by the host. The dev dependency is pinned to the host's version (3.7.0), whose axis
  behaviour differs from newer ones.
- Only the host's compiled Tailwind applies inside the addon's iframe. Check each utility class there; e.g.
  use `text-start`/`ms-auto` where `text-left`/`ml-auto` are missing.
- Compact icon buttons must use `icon-xs` and the host's responsive size overrides (`COMPACT_ICON_BUTTON`):
  `icon` enforces a 44px minimum on mobile, and `icon-xs` alone grows to 36px. Both inflate badges and metric
  labels despite plain `h-*`/`size-*` classes. The host's compact pattern enlarges the touch area with `::after`.
- Host components such as the account and benchmark selectors are not exported; `AccountScope`,
  `BenchmarkPicker`, `Badges` and `MetricStrip` rebuild them with the host's classes.
- `ctx.api.market.*` needs the permission category `market-data`. A wrong category passes validation, but
  `searchTicker` then fails silently.
- Runtime data differs from the SDK types: `getHoldings` returns `lots: null`, activity rows carry
  `sourceGroupId`, `searchTicker` returns `quoteMode`.
- Storage keys allow only letters, digits and `_ . : -`.
- Yahoo answers 429 through the network broker without a browser User-Agent.
- Balance privacy does not reach the addon; `useBalancePrivacy` always reports “visible”.

## Testing in Wealthfolio

- Run `wealthfolio/wealthfolio:<version>` with `WF_AUTH_REQUIRED=false` and a `WF_SECRET_KEY`, bound to
  `127.0.0.1`.
- Install with `POST /api/v1/addons/install-zip` (`zipDataB64`, `enableAfterInstall`,
  `approvedNetworkHosts`); create synthetic data with `POST /api/v1/accounts` and
  `POST /api/v1/activities/bulk`.
- The addon renders in a `srcdoc` iframe with its own scroll; reach its content through
  `page.frameLocator('iframe')`.

## Screenshots

`docs/screenshot-{light,dark}.png` come from `scripts/screenshot.mjs`: it seeds a synthetic portfolio into a
fresh instance, installs the addon and captures both themes. Run the Screenshots workflow (it opens a pull
request), or locally `WEALTHFOLIO_URL=http://127.0.0.1:8088 npm run screenshot` against a disposable instance
(the script adds data on every run).
