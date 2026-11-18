# IJmond 360 Portal

Monorepo (pnpm workspaces, TypeScript, Node 24). Employee start page of IJmond 360.

- `branding/`: house styles (only `ijmond360` now), `branding/active-brand`, imported as `@brand/...`; colours/fonts only from `tokens.css` (`--tvsm-*` prefix kept for compatibility with TV Station Manager).
- `packages/platform` (`@portal/platform`): shared server copied from TV Station Manager (Fastify + node:sqlite): auth, SSO (`src/sso.ts`, Entra ID; `SsoService.setHooks({ scopes, onSignIn })` lets the app add Graph scopes and receive tokens, `refresh()` for refresh tokens), SMTP mail, backup/restore (FTP/FTPS/SCP/SMB/OneDrive, full + incremental), self-update from GitHub releases (`src/update.ts`, asset `ijmond360-portal_<version>_<arch>.deb`, helper `/usr/lib/ijmond360-portal/apply-update`). Env vars `PORTAL_*`.
- `packages/ui` (`@portal/ui`): React 19, Tailwind 4, i18next EN/NL, left sidebar, Info dialog, system pages; apps call `mountPlatformApp`.
- `apps/portal`: `server/portallogic.ts` is pure (schemas, visibility `canSee`, XMLTV `parseXmltv`/`nowNext`, Graph result mapping with Outlook/Teams link allowlist), `server/portal.ts` (migrations `PORTAL_MIGRATIONS`, append-only; tabs/sections/apps/groups/notices/favorites, logos in `<dataDir>/logos`, settings key `portal.settings`), `server/m365.ts` (refresh token per user encrypted in `portal_graph_tokens`, single-flight refresh because Entra rotates it, 60 s cache), `server/health.ts` (status lights, 60 s), `server/tv.ts` (Now on TV from the TVSM XMLTV feed). Web: `web/pages/Home.tsx`, admin pages `web/pages/Admin*.tsx`, i18n `web/i18n/{en,nl}.json` (same keys).
- `packaging/`: `debian/build-deb.sh <version>` builds `ijmond360-portal` (bundled Node, user `portal`, `/usr/lib|/var/lib|/etc/ijmond360-portal`), `install.sh` (GitHub releases, `--token` for the private repo). Docs: `docs/install.md` (Entra app registration).

Rules:
- Every user-facing string goes through i18n with both `en` and `nl` keys.
- Admin UIs keep the menu on the left and the Info button in the sidebar.
- Every feature PR adds `changelog/<package.json version>/<feature>.json` (EN + NL), see `CONTRIBUTING.md`.
- Branches: feature branch -> PR into `test` -> merge `test` into `production`; pushes to either publish a release (`.github/workflows/release.yml`).

Commands: `pnpm install`, `pnpm typecheck`, `pnpm test`, `pnpm dev` (API :8080, UI :5173).
