# Installing the portal

The portal runs as one Debian 13 package (`ijmond360-portal`) with its own Node.js runtime.
It listens on port 8080; put a reverse proxy with TLS in front of it (IJmond 360: Zoraxy,
`https://portal.ijmond360.it` -> `http://10.40.4.20:8080`).

## 1. Install

On a fresh Debian 13 machine or LXC container:

```sh
curl -fsSL https://raw.githubusercontent.com/rhisijmuiden/ijmond360-portal/production/packaging/install.sh \
  | sudo bash -s -- --token <github token with read access>
```

- `--channel test` installs the latest test release instead of production.
- `--token` is only needed while the repository is private (a fine-grained token with *Contents: read*).
- `--file ijmond360-portal_<version>_amd64.deb` installs a package you already downloaded.

Files: program in `/usr/lib/ijmond360-portal`, data in `/var/lib/ijmond360-portal`,
settings in `/etc/ijmond360-portal/env` (`PORTAL_PORT`, `PORTAL_HOST`, `PORTAL_DEFAULT_ADMIN`).
Service: `systemctl status ijmond360-portal`, logs: `journalctl -u ijmond360-portal -f`.

The first start creates the local account `admin` / `admin`. Sign in, change the password,
and keep this account as a way in when Microsoft is unreachable.

## 2. App registration in Microsoft Entra ID

In the Entra admin centre (entra.microsoft.com) of the IJmond 360 tenant:

1. **App registrations > New registration**
   - Name: `IJmond 360 Portal`
   - Supported account types: *Accounts in this organizational directory only* (single tenant)
   - Redirect URI: platform *Web*, `https://portal.ijmond360.it/api/auth/sso/callback`
2. **Certificates & secrets > New client secret**. Copy the *Value* (not the ID). Note the expiry date.
3. **API permissions > Add a permission > Microsoft Graph > Delegated permissions**:
   `openid`, `profile`, `email`, `offline_access`, `User.Read`, `Mail.Read`, `Calendars.Read`.
   Then **Grant admin consent for IJmond 360**, so employees do not get a consent question.
4. Optional, to show tabs and buttons only to some colleagues: **Token configuration > Add groups claim**,
   *Security groups*, ID token: *Group ID*. Then add the groups in the portal under *Manage portal > Groups*
   with their Object ID.
5. Optional, to make IT staff admins automatically: **App roles** with value `admin`, assigned under
   *Enterprise applications > IJmond 360 Portal > Users and groups*. Without app roles everybody
   becomes a normal user and you promote admins under *System > Users*.

Copy the **Application (client) ID** and the **Directory (tenant) ID** from the overview page.

## 3. Connect the portal to Microsoft

Sign in as `admin`, open **System > Single sign-on**:

- Enabled: on
- Tenant ID, client ID, client secret: from step 2
- Public URL: `https://portal.ijmond360.it` (must match the redirect URI)
- Create users automatically: on, default role: operator (a normal employee)
- *Test connection*, then save.

Sign out: the sign-in page now shows *Sign in with Microsoft 365*. Every account in the tenant can sign in.
At the first Microsoft sign-in the portal also receives a refresh token for Mail.Read and Calendars.Read,
so the start page shows the employee's latest mail and today's appointments. The token is stored
encrypted per user and is removed when Microsoft rejects it (the block then asks to sign in again).

## 4. Fill the portal

- **Manage portal > Apps and tabs**: tabs per workplace (Televisie, Radio, ...), sections per tab, buttons with
  name, description, link, icon or logo, colour, optional status check URL and groups.
- **Manage portal > Notices**: messages on top of the start page, with start and end time.
- **Manage portal > Settings**: title, mail and calendar blocks, and *Now on TV* (the XMLTV feed of
  TV Station Manager: EPG page, link with token).

## 5. System pages

Like every IJmond 360 app: *System > Mail server* (SMTP for alerts), *System > Backup* (FTP, FTPS, SCP,
SMB, OneDrive; full and incremental, restore from the remote location), *Info* in the sidebar with the
version, *Check for updates*, *Install update* and the switch between the production and test channel.
While the repository is private, enter a GitHub token under *System > Updates*.
