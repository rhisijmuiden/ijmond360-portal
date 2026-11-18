import { startPlatform } from "@portal/platform";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { registerPortalApp } from "./app.js";
import { PORTAL_MIGRATIONS } from "./portal.js";

const here = dirname(fileURLToPath(import.meta.url));

await startPlatform({
  app: { id: "portal", name: "IJmond 360 Portal", defaultPort: 8080 },
  // Packaged: /usr/lib/ijmond360-portal/{server.mjs,web/}. Dev: built UI in dist/web (or use Vite on :5173).
  webDir: process.env.PORTAL_WEB_DIR ?? join(here, "web"),
  // Append-only: migrations are numbered by position.
  migrations: [...PORTAL_MIGRATIONS],
  register: (server, platform) => {
    registerPortalApp(server, platform);
  },
});
