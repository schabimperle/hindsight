# Third-party notices

`src/vendor/wealthfolio/history-chart-marker.tsx` is copied unchanged from
Wealthfolio v3.12.0, commit `f217ef5fbe76eecb5c5ceac53ee2514dee706c81`:
https://github.com/wealthfolio/wealthfolio/blob/f217ef5fbe76eecb5c5ceac53ee2514dee706c81/apps/frontend/src/components/history-chart-marker.tsx

Copyright Wealthfolio contributors. License: AGPL-3.0-only (full text in
`LICENSES/AGPL-3.0-only.txt` and beside the vendored source). Hindsight combines
this component with MIT-licensed original code; the combined addon is also
subject to the AGPL terms. This project is independent of Wealthfolio.

Vite emits license texts and package versions for the dependencies actually
bundled in `dist/addon.js` into `dist/third-party-NOTICES.txt`. Host-provided
libraries remain external and are supplied by Wealthfolio. Locked dependency
versions and download locations are recorded in `package-lock.json`.

The installable ZIP contains `dist/hindsight-source.zip` with the matching
Hindsight sources, build scripts, dependency lockfile and license notices.
Rebuild with the commands in README.md. No account data or credentials are
required to build or run the synthetic tests.
