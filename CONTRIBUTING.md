# Contributing

Use Node.js 22.12+ and Python 3.12+. Run `npm ci --ignore-scripts`, `npm run check`
and `npm run package` from the repository root. Commit the lockfile when dependencies change.

Keep the pure calculation model independent of Wealthfolio. Explain calculation changes
in `docs/MODEL.md`, update the Python oracle deliberately, and add synthetic cases covering
the behavior. Put user-visible text in both English and German translation files.

For host integration changes, check the pinned SDK manifest and runtime dependencies.
A typecheck alone does not prove compatibility with the host iframe and compiled CSS;
see `docs/DEVELOPMENT.md` for integration checks.

Do not submit account exports, tokens, identifiers or screenshots containing personal
financial information. Use synthetic reproductions in issues and patches.

Original contributions are MIT-licensed; retain the licenses of vendored components.
