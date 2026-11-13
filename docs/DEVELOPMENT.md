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
- Tailwind utilities come from the host's compiled stylesheet. Check each utility class there; e.g.
  use `text-start`/`ms-auto` where `text-left`/`ml-auto` are missing.
- The sandbox loads bundled CSS before enabling the addon (including on 3.12). `compact.css` owns compact
  button dimensions and 44px touch targets across host versions; host `icon-xs` alone grows to 36px on 3.13.
  Keep adjacent controls out of those touch targets. Carousels clip horizontally with `clip`, not `hidden`,
  so the vertical touch area stays visible without enlarging the cards.
- Host components such as the account and benchmark selectors are not exported; `AccountScope`,
  `BenchmarkPicker`, `Badges` and `MetricStrip` rebuild them with the host's classes.
- `ctx.api.market.*` needs the permission category `market-data`. A wrong category passes validation, but
  `searchTicker` then fails silently.
- Runtime data differs from the SDK types: `getHoldings` returns `lots: null`, activity rows carry
  `sourceGroupId`, `searchTicker` returns `quoteMode`.
- Wealthfolio 3.13's startup update can make `getHoldings` reject while projections are pending. The list
  endpoint reports `pending / PROJECTION_PENDING`, but the SDK's complete-holdings endpoint turns that into
  HTTP 400 `internal_error`. Subscribe to `events.portfolio.onUpdateComplete` before mounting the route and
  cancel then invalidate Hindsight's data queries on completion. The sandbox has its own QueryClient; host
  invalidation does not reach it. Cancel first: invalidation alone can reuse an initial in-flight request.
- Storage keys allow only letters, digits and `_ . : -`.
- Yahoo answers 429 through the network broker without a browser User-Agent.
- Balance privacy does not reach the addon; `useBalancePrivacy` always reports “visible”.

## Testing in Wealthfolio

- Run `wealthfolio/wealthfolio:<version>` with `WF_AUTH_REQUIRED=false` and a `WF_SECRET_KEY`, bound to
  `127.0.0.1`.
- Install with `POST /api/v1/addons/install-zip` (`zipDataB64`, `enableAfterInstall`,
  `approvedNetworkHosts`); create synthetic data with `POST /api/v1/accounts` and
  `POST /api/v1/activities/bulk`.
- CI runs `npm run test:layout` against fresh Wealthfolio 3.12 and 3.13 instances; the Release workflow waits
  for it. It checks control heights, alignment, vertical scrollbars, horizontal page overflow and that no
  ancestor clips a control's enlarged touch target, at 360/412/1000/1240px (1000px gives a 768-1023px iframe:
  wide controls under the host's mobile `.flex { overflow-x: hidden }` reset), with touch and mouse, in both
  themes and marker states. The script accepts only a loopback `WEALTHFOLIO_URL` with no existing accounts, and
  seeds synthetic cash flows and CPI data; it does not need Yahoo or OECD responses. On a host-network
  container loopback still reaches the host, so the empty-account check is the real guard. `CHROME_PATH`
  optionally selects Chromium.
- The addon renders in a `srcdoc` iframe with its own scroll; reach its content through
  `page.frameLocator('iframe')`.

## Screenshots

`docs/screenshot-{light,dark}.png` come from `scripts/screenshot.mjs`: it seeds a synthetic portfolio into a
fresh instance, installs the addon and captures both themes. Run the Screenshots workflow (it opens a pull
request), or locally `WEALTHFOLIO_URL=http://127.0.0.1:8088 npm run screenshot` against a disposable instance
(the script adds data on every run).
