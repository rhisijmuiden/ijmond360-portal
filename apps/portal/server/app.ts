/** Wires the portal parts together (shared by main.ts and the API tests). */
import type { FastifyInstance } from "fastify";
import type { Platform } from "@portal/platform";
import { HealthChecker, probe } from "./health.js";
import { M365, registerM365 } from "./m365.js";
import { registerPortal } from "./portal.js";
import { registerTv, TvGuide } from "./tv.js";

export function registerPortalApp(server: FastifyInstance, platform: Platform, opts: { probe?: typeof probe; health?: boolean } = {}) {
  const portal = registerPortal(server, platform);
  const enabled = () => portal.getSettings().m365;
  const m365 = new M365(platform, enabled);
  registerM365(server, m365, enabled);

  // Microsoft sign-in: ask for Graph mail/calendar access and remember the user's groups.
  platform.sso.setHooks({
    scopes: () => m365.scopes(),
    onSignIn: (userId, tokens, claims) => {
      portal.rememberGroups(userId, claims.groups);
      if (m365.scopes().length) m365.store(userId, tokens);
    },
  });

  const guide = new TvGuide(() => portal.getSettings().tv);
  registerTv(server, guide);

  const health = new HealthChecker(platform, portal.healthTargets, opts.probe);
  portal.onAppsChanged((id) => {
    const t = portal.healthTargets().find((x) => x.id === id);
    if (t) void health.check(t.id, t.url).catch(() => undefined);
  });
  portal.onSettingsChanged(() => guide.reset());
  if (opts.health !== false) {
    health.start();
    server.addHook("onClose", async () => health.stop());
  }
  return { portal, m365, guide, health };
}
