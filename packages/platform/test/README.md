# Platform tests

`pnpm --filter @portal/platform test` runs unit tests and the API tests.

The backup tests run against real servers when these variables are set:

| Variable | Example |
|---|---|
| `PORTAL_IT_FTP_HOST`, `PORTAL_IT_FTP_PORT`, `PORTAL_IT_FTP_USER`, `PORTAL_IT_FTP_PASS` | an FTP server that also supports explicit FTPS (AUTH TLS) |
| `PORTAL_IT_SMB_HOST`, `PORTAL_IT_SMB_PORT` (optional), `PORTAL_IT_SMB_SHARE`, `PORTAL_IT_SMB_USER`, `PORTAL_IT_SMB_PASS` | an SMB server (Samba, Windows, NAS); needs `smbclient` installed |
| `PORTAL_IT_SCP_HOST`, `PORTAL_IT_SCP_PORT`, `PORTAL_IT_SCP_USER`, `PORTAL_IT_SCP_KEY` | an SSH server; `PORTAL_IT_SCP_KEY` is a path to a private key |

OneDrive always runs, against the in-process Microsoft login + Graph mock in `test/graph-mock.ts`.
