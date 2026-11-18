# IJmond 360 Portal

[Nederlands](README.nl.md)

One start page for every IJmond 360 employee: all internal apps and links as clear buttons,
grouped in tabs per workplace (Television, Radio, ...), with sign-in through Microsoft 365
and the employee's latest mail and today's calendar on top.

- Microsoft Entra ID single sign-on for every account in the IJmond 360 tenant (local admin account as fallback).
- Tabs, sections and buttons managed in the browser: name, what the app is for, link, icon or logo, colour.
- Visibility per tab or button by Microsoft group; favourites per employee; search with `/`.
- Status light per button (HTTP check every minute), notices with start and end time.
- Mail and calendar from Microsoft 365 (Graph, delegated Mail.Read and Calendars.Read), *Now on TV* from TV Station Manager.
- Shared platform: SMTP mail server, backups (FTP, FTPS, SCP, SMB, OneDrive; full + incremental, restore),
  Info dialog with version and updates from the UI, production and test channel.
- English and Dutch, IJmond 360 house style (`branding/ijmond360`).

## Install

See [docs/install.md](docs/install.md) (Debian 13 package, Entra app registration, first setup).

## Develop

```sh
pnpm install
pnpm dev          # API on :8080, UI on :5173
pnpm typecheck
pnpm test
```

Layout: `apps/portal` (server + web), `packages/platform` (Fastify, auth, SSO, mail, backup, updates),
`packages/ui` (React UI shell), `branding/` (house styles), `packaging/` (.deb and installer).

## Releases

Feature branch -> pull request into `test` -> merge `test` into `production`.
Every push to `test` publishes a pre-release `v<version>-test.<run>`, every push to `production` a release
`v<version>`. Installed portals see them under *Info > Check for updates* for their channel.
See [CONTRIBUTING.md](CONTRIBUTING.md).
