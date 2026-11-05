# Wealthfolio chart markers

`history-chart-marker.tsx` is copied **unchanged** from Wealthfolio v3.12.0,
commit `f217ef5fbe76eecb5c5ceac53ee2514dee706c81`:
https://github.com/wealthfolio/wealthfolio/blob/f217ef5fbe76eecb5c5ceac53ee2514dee706c81/apps/frontend/src/components/history-chart-marker.tsx

Copyright Wealthfolio contributors, AGPL-3.0-only (see LICENSE). The addon manifest
declares `MIT AND AGPL-3.0-only`; the build includes the full license text,
third-party notices and matching Hindsight source archive under `dist/` in the ZIP.

The account detail chart uses this component with Recharts `ReferenceDot`.
It is not exported by `@wealthfolio/ui`; keeping the original here lets the addon
use the same implementation. When the host SDK exports it, replace this copy
with an import. Update against the pinned host version when upgrading Wealthfolio.
