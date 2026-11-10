# Contributing

Issues and pull requests are welcome. Never share real account data; use synthetic examples.

## Setup

Node.js 22.12+ and Python 3.12+.

```sh
npm ci --ignore-scripts
npm run check
npm run package
```

## Rules

- `reference/oracle.py` defines the calculations. Change it first, then `src/core/`, and add a synthetic
  case. Never regenerate expected results to make a test pass.
- Document calculation changes in [docs/MODEL.md](docs/MODEL.md).
- UI text goes into `src/i18n/en.json` and `de.json`.
- Keep the addon ID `hindsight` and stored settings compatible.
- Keep provenance and license of vendored code in `src/vendor/`.

Architecture and host quirks: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Releasing

Add your changes under `## Unreleased` in `CHANGELOG.md`, then:

```sh
npm version <patch|minor|major>   # bumps package.json and manifest.json, dates the changelog, tags vX.Y.Z
git push --follow-tags
```

The tag runs `.github/workflows/release.yml`, which checks, builds and publishes the ZIP as a GitHub release.
