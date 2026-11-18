# Contributing

## Branches and releases
- Work on a feature branch, open a pull request into `test`.
- A push to `test` publishes pre-release `v<version>-test.<run>` (GitHub Actions, `.github/workflows/release.yml`).
- Merge `test` into `production` for a release `v<version>`. Bump `version` in the root `package.json` first.

## Changelog
Every feature PR adds `changelog/<package.json version>/<feature>.json`:

```json
{ "apps": ["portal"], "changes": [{ "kind": "added", "en": "…", "nl": "…" }] }
```

Kinds: added, changed, improved, fixed, removed. Apps: `portal`, `platform`. The entries are shown under
*Info > What's new* and used as release notes. On a production release set `date` in
`changelog/<version>/release.json`, bump the version and create the next `release.json` without a date.

## Rules
- Every user-facing string goes through i18n with both `en` and `nl`.
- Admin pages keep the menu on the left and the Info button in the sidebar.
- Colours and fonts only from the brand tokens (`--tvsm-*`).
- `pnpm typecheck && pnpm test` must pass.
