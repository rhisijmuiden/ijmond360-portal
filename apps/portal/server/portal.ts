/**
 * Tabs, sections, buttons (apps), favourites, groups and notices. Everyone signed in reads what they may see;
 * admins change it (`/api/portal/admin/*`).
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { HttpError, requireRole, type Platform } from "@portal/platform";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  activeNotices,
  appSchema,
  canSee,
  claimGroups,
  groupSchema,
  noticeSchema,
  parseIds,
  publicSettings,
  sameIds,
  sectionSchema,
  settingsSchema,
  tabSchema,
  type PortalSettings,
  type Viewer,
} from "./portallogic.js";

export const PORTAL_MIGRATIONS = [
  `CREATE TABLE portal_tabs (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name_en TEXT NOT NULL,
     name_nl TEXT NOT NULL DEFAULT '',
     icon TEXT NOT NULL DEFAULT 'layout-grid',
     groups TEXT NOT NULL DEFAULT '[]',
     is_home INTEGER NOT NULL DEFAULT 0,
     sort INTEGER NOT NULL DEFAULT 0
   );
   CREATE TABLE portal_sections (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     tab_id INTEGER NOT NULL REFERENCES portal_tabs(id) ON DELETE CASCADE,
     name_en TEXT NOT NULL,
     name_nl TEXT NOT NULL DEFAULT '',
     sort INTEGER NOT NULL DEFAULT 0
   );
   CREATE TABLE portal_apps (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     tab_id INTEGER NOT NULL REFERENCES portal_tabs(id) ON DELETE CASCADE,
     section_id INTEGER REFERENCES portal_sections(id) ON DELETE SET NULL,
     name TEXT NOT NULL,
     description_en TEXT NOT NULL DEFAULT '',
     description_nl TEXT NOT NULL DEFAULT '',
     url TEXT NOT NULL,
     icon TEXT NOT NULL DEFAULT 'app-window',
     color TEXT NOT NULL DEFAULT 'purple',
     logo TEXT,
     new_window INTEGER NOT NULL DEFAULT 1,
     check_health INTEGER NOT NULL DEFAULT 1,
     health_url TEXT NOT NULL DEFAULT '',
     groups TEXT NOT NULL DEFAULT '[]',
     sort INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE TABLE portal_health (
     app_id INTEGER PRIMARY KEY REFERENCES portal_apps(id) ON DELETE CASCADE,
     status TEXT NOT NULL,
     http_status INTEGER,
     latency_ms INTEGER,
     error TEXT,
     checked_at TEXT NOT NULL
   );
   CREATE TABLE portal_favorites (
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     app_id INTEGER NOT NULL REFERENCES portal_apps(id) ON DELETE CASCADE,
     sort INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (user_id, app_id)
   );
   CREATE TABLE portal_groups (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL,
     object_id TEXT NOT NULL UNIQUE
   );
   CREATE TABLE portal_user_groups (
     user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
     groups TEXT NOT NULL DEFAULT '[]',
     updated_at TEXT NOT NULL
   );
   CREATE TABLE portal_notices (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     text_en TEXT NOT NULL DEFAULT '',
     text_nl TEXT NOT NULL DEFAULT '',
     level TEXT NOT NULL DEFAULT 'info',
     starts_at TEXT,
     ends_at TEXT,
     created_by TEXT,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE TABLE portal_graph_tokens (
     user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
     refresh_token TEXT NOT NULL,
     access_token TEXT NOT NULL DEFAULT '',
     expires_at INTEGER NOT NULL DEFAULT 0,
     updated_at TEXT NOT NULL
   );
   INSERT INTO portal_tabs (name_en, name_nl, icon, is_home, sort) VALUES ('Start', 'Start', 'house', 1, 0);`,
];

type Row = Record<string, unknown>;
const SETTINGS_KEY = "portal.settings";
const LOGO_MIME: Record<string, string> = { png: "image/png", svg: "image/svg+xml", webp: "image/webp", jpg: "image/jpeg" };

export function registerPortal(app: FastifyInstance, platform: Platform) {
  const { db, settings, config } = platform.ctx;
  const logoDir = join(config.dataDir, "logos");
  if (!existsSync(logoDir)) mkdirSync(logoDir, { recursive: true });
  platform.ctx.backupPaths.push(logoDir);

  const getSettings = (): PortalSettings => settingsSchema.parse(settings.get(SETTINGS_KEY, {}));

  const groupMap = () => new Map((db.prepare("SELECT id, object_id FROM portal_groups").all() as Row[]).map((r) => [Number(r.id), String(r.object_id)]));
  const viewer = (req: FastifyRequest): Viewer => {
    const row = db.prepare("SELECT groups FROM portal_user_groups WHERE user_id = ?").get(req.user!.id) as Row | undefined;
    return { isAdmin: req.user!.role === "admin", groupObjectIds: row ? (JSON.parse(String(row.groups)) as string[]) : [] };
  };

  const tabOut = (r: Row) => ({ id: Number(r.id), nameEn: String(r.name_en), nameNl: String(r.name_nl), icon: String(r.icon), groups: parseIds(r.groups), isHome: !!r.is_home, sort: Number(r.sort) });
  const sectionOut = (r: Row) => ({ id: Number(r.id), tabId: Number(r.tab_id), nameEn: String(r.name_en), nameNl: String(r.name_nl), sort: Number(r.sort) });
  const appOut = (r: Row) => ({
    id: Number(r.id),
    tabId: Number(r.tab_id),
    sectionId: r.section_id === null ? null : Number(r.section_id),
    name: String(r.name),
    descriptionEn: String(r.description_en),
    descriptionNl: String(r.description_nl),
    url: String(r.url),
    icon: String(r.icon),
    color: String(r.color),
    logo: r.logo ? `/api/portal/apps/${r.id}/logo?v=${encodeURIComponent(String(r.logo))}` : null,
    newWindow: !!r.new_window,
    checkHealth: !!r.check_health,
    healthUrl: String(r.health_url),
    groups: parseIds(r.groups),
    sort: Number(r.sort),
    health: r.check_health
      ? { status: (r.h_status as string) ?? "unknown", httpStatus: (r.h_http as number) ?? null, latencyMs: (r.h_latency as number) ?? null, checkedAt: (r.h_at as string) ?? null }
      : null,
  });
  const APPS_SQL = `SELECT a.*, h.status AS h_status, h.http_status AS h_http, h.latency_ms AS h_latency, h.checked_at AS h_at
                    FROM portal_apps a LEFT JOIN portal_health h ON h.app_id = a.id`;
  const allTabs = () => (db.prepare("SELECT * FROM portal_tabs ORDER BY is_home DESC, sort, id").all() as Row[]).map(tabOut);
  const allSections = () => (db.prepare("SELECT * FROM portal_sections ORDER BY sort, id").all() as Row[]).map(sectionOut);
  const allApps = () => (db.prepare(`${APPS_SQL} ORDER BY a.sort, a.id`).all() as Row[]).map(appOut);
  const noticeOut = (r: Row) => ({
    id: Number(r.id),
    textEn: String(r.text_en),
    textNl: String(r.text_nl),
    level: String(r.level),
    startsAt: (r.starts_at as string) ?? null,
    endsAt: (r.ends_at as string) ?? null,
    createdBy: (r.created_by as string) ?? null,
  });
  const allNotices = () => (db.prepare("SELECT * FROM portal_notices ORDER BY COALESCE(starts_at, created_at) DESC, id DESC").all() as Row[]).map(noticeOut);

  /** What this user sees: tabs and apps filtered by group, with favourites. */
  app.get("/api/portal", async (req) => {
    const v = viewer(req);
    const groups = groupMap();
    // Admins see everything in the admin pages; on the portal itself they see what they would see as a user,
    // plus items restricted to groups (marked in the UI), so they can check them.
    const tabs = allTabs().filter((t) => canSee(t.groups, groups, v));
    const tabIds = new Set(tabs.map((t) => t.id));
    const apps = allApps()
      .filter((a) => tabIds.has(a.tabId) && canSee(a.groups, groups, v))
      .map(({ healthUrl: _h, ...a }) => a);
    const favorites = (db.prepare("SELECT app_id FROM portal_favorites WHERE user_id = ? ORDER BY sort, app_id").all(req.user!.id) as Row[])
      .map((r) => Number(r.app_id))
      .filter((id) => apps.some((a) => a.id === id));
    return {
      settings: publicSettings(getSettings()),
      tabs,
      sections: allSections().filter((s) => tabIds.has(s.tabId)),
      apps,
      favorites,
      notices: activeNotices(allNotices(), Date.now()).map(({ createdBy: _c, ...n }) => n),
      microsoft: { signedIn: req.user!.authProvider === "entra" },
    };
  });

  // ---- favourites ---------------------------------------------------------------------------------------
  app.put("/api/portal/favorites", async (req) => {
    const { appIds } = z.object({ appIds: z.array(z.number().int().positive()).max(200) }).parse(req.body);
    const v = viewer(req);
    const groups = groupMap();
    const allowed = new Set(allApps().filter((a) => canSee(a.groups, groups, v)).map((a) => a.id));
    const ids = [...new Set(appIds)].filter((id) => allowed.has(id));
    db.exec("BEGIN");
    try {
      db.prepare("DELETE FROM portal_favorites WHERE user_id = ?").run(req.user!.id);
      const ins = db.prepare("INSERT INTO portal_favorites (user_id, app_id, sort) VALUES (?, ?, ?)");
      ids.forEach((id, i) => ins.run(req.user!.id, id, i));
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    return { favorites: ids };
  });

  // ---- logos ----------------------------------------------------------------------------------------------
  app.get("/api/portal/apps/:id/logo", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const row = db.prepare("SELECT logo, groups FROM portal_apps WHERE id = ?").get(id) as Row | undefined;
    if (!row?.logo || !canSee(parseIds(row.groups), groupMap(), viewer(req))) throw new HttpError(404, "not_found");
    const file = join(logoDir, String(row.logo));
    if (!existsSync(file)) throw new HttpError(404, "not_found");
    const ext = String(row.logo).split(".").pop()!;
    // An SVG opened on its own must not run scripts.
    return reply
      .header("Content-Type", LOGO_MIME[ext] ?? "application/octet-stream")
      .header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
      .header("Cache-Control", "private, max-age=86400")
      .send(readFileSync(file));
  });

  // ---- admin --------------------------------------------------------------------------------------------
  const admin = (req: FastifyRequest) => requireRole(req, "admin");
  const idParam = (req: FastifyRequest) => z.coerce.number().int().positive().parse((req.params as { id: string }).id);
  const must = (row: unknown) => {
    if (!row) throw new HttpError(404, "not_found");
  };
  const checkGroups = (ids: number[]) => {
    const known = groupMap();
    if (ids.some((id) => !known.has(id))) throw new HttpError(400, "unknown_group");
    return JSON.stringify(ids);
  };
  const reorder = (table: string, where: string, args: (string | number)[], order: number[]) => {
    const existing = (db.prepare(`SELECT id FROM ${table} WHERE ${where}`).all(...args) as Row[]).map((r) => Number(r.id));
    if (!sameIds(existing, order)) throw new HttpError(400, "order_mismatch");
    const up = db.prepare(`UPDATE ${table} SET sort = ? WHERE id = ?`);
    db.exec("BEGIN");
    order.forEach((id, i) => up.run(i, id));
    db.exec("COMMIT");
  };

  app.get("/api/portal/admin", async (req) => {
    admin(req);
    const groups = (db.prepare("SELECT * FROM portal_groups ORDER BY name").all() as Row[]).map((r) => ({ id: Number(r.id), name: String(r.name), objectId: String(r.object_id) }));
    return { settings: getSettings(), tabs: allTabs(), sections: allSections(), apps: allApps(), groups, notices: allNotices() };
  });

  // Tabs
  app.post("/api/portal/admin/tabs", async (req) => {
    admin(req);
    const b = tabSchema.parse(req.body);
    const sort = (db.prepare("SELECT COALESCE(MAX(sort), 0) + 1 AS s FROM portal_tabs").get() as Row).s;
    const r = db.prepare("INSERT INTO portal_tabs (name_en, name_nl, icon, groups, sort) VALUES (?, ?, ?, ?, ?)").run(b.nameEn, b.nameNl, b.icon, checkGroups(b.groups), Number(sort));
    return tabOut(db.prepare("SELECT * FROM portal_tabs WHERE id = ?").get(Number(r.lastInsertRowid)) as Row);
  });
  app.put("/api/portal/admin/tabs/:id", async (req) => {
    admin(req);
    const id = idParam(req);
    const cur = db.prepare("SELECT * FROM portal_tabs WHERE id = ?").get(id) as Row | undefined;
    must(cur);
    const b = tabSchema.parse(req.body);
    // The start tab is for everyone.
    const groups = cur!.is_home ? "[]" : checkGroups(b.groups);
    db.prepare("UPDATE portal_tabs SET name_en = ?, name_nl = ?, icon = ?, groups = ? WHERE id = ?").run(b.nameEn, b.nameNl, b.icon, groups, id);
    return tabOut(db.prepare("SELECT * FROM portal_tabs WHERE id = ?").get(id) as Row);
  });
  app.delete("/api/portal/admin/tabs/:id", async (req) => {
    admin(req);
    const id = idParam(req);
    const cur = db.prepare("SELECT is_home FROM portal_tabs WHERE id = ?").get(id) as Row | undefined;
    must(cur);
    if (cur!.is_home) throw new HttpError(400, "home_tab");
    const logos = (db.prepare("SELECT logo FROM portal_apps WHERE tab_id = ? AND logo IS NOT NULL").all(id) as Row[]).map((r) => String(r.logo));
    db.prepare("DELETE FROM portal_tabs WHERE id = ?").run(id);
    for (const l of logos) rmSync(join(logoDir, l), { force: true });
    return { ok: true };
  });
  app.put("/api/portal/admin/tabs-order", async (req) => {
    admin(req);
    const { order } = z.object({ order: z.array(z.number().int()) }).parse(req.body);
    reorder("portal_tabs", "is_home = 0", [], order);
    return { ok: true };
  });

  // Sections
  app.post("/api/portal/admin/sections", async (req) => {
    admin(req);
    const b = sectionSchema.parse(req.body);
    must(db.prepare("SELECT id FROM portal_tabs WHERE id = ?").get(b.tabId));
    const sort = (db.prepare("SELECT COALESCE(MAX(sort), 0) + 1 AS s FROM portal_sections WHERE tab_id = ?").get(b.tabId) as Row).s;
    const r = db.prepare("INSERT INTO portal_sections (tab_id, name_en, name_nl, sort) VALUES (?, ?, ?, ?)").run(b.tabId, b.nameEn, b.nameNl, Number(sort));
    return sectionOut(db.prepare("SELECT * FROM portal_sections WHERE id = ?").get(Number(r.lastInsertRowid)) as Row);
  });
  app.put("/api/portal/admin/sections/:id", async (req) => {
    admin(req);
    const id = idParam(req);
    must(db.prepare("SELECT id FROM portal_sections WHERE id = ?").get(id));
    const b = sectionSchema.omit({ tabId: true }).parse(req.body);
    db.prepare("UPDATE portal_sections SET name_en = ?, name_nl = ? WHERE id = ?").run(b.nameEn, b.nameNl, id);
    return sectionOut(db.prepare("SELECT * FROM portal_sections WHERE id = ?").get(id) as Row);
  });
  app.delete("/api/portal/admin/sections/:id", async (req) => {
    admin(req);
    const id = idParam(req);
    must(db.prepare("SELECT id FROM portal_sections WHERE id = ?").get(id));
    // Its buttons stay on the tab, without a section.
    db.prepare("DELETE FROM portal_sections WHERE id = ?").run(id);
    return { ok: true };
  });
  app.put("/api/portal/admin/sections-order", async (req) => {
    admin(req);
    const { tabId, order } = z.object({ tabId: z.number().int(), order: z.array(z.number().int()) }).parse(req.body);
    reorder("portal_sections", "tab_id = ?", [tabId], order);
    return { ok: true };
  });

  // Apps (buttons)
  const checkPlace = (tabId: number, sectionId: number | null) => {
    if (!db.prepare("SELECT id FROM portal_tabs WHERE id = ?").get(tabId)) throw new HttpError(400, "unknown_tab");
    if (sectionId !== null && !db.prepare("SELECT id FROM portal_sections WHERE id = ? AND tab_id = ?").get(sectionId, tabId)) throw new HttpError(400, "unknown_section");
  };
  const oneApp = (id: number) => appOut(db.prepare(`${APPS_SQL} WHERE a.id = ?`).get(id) as Row);
  app.post("/api/portal/admin/apps", async (req) => {
    admin(req);
    const b = appSchema.parse(req.body);
    checkPlace(b.tabId, b.sectionId);
    const sort = (db.prepare("SELECT COALESCE(MAX(sort), 0) + 1 AS s FROM portal_apps WHERE tab_id = ?").get(b.tabId) as Row).s;
    const r = db
      .prepare(
        `INSERT INTO portal_apps (tab_id, section_id, name, description_en, description_nl, url, icon, color, new_window, check_health, health_url, groups, sort)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(b.tabId, b.sectionId, b.name, b.descriptionEn, b.descriptionNl, b.url, b.icon, b.color, b.newWindow ? 1 : 0, b.checkHealth ? 1 : 0, b.healthUrl, checkGroups(b.groups), Number(sort));
    const id = Number(r.lastInsertRowid);
    onAppsChanged?.(id);
    return oneApp(id);
  });
  app.put("/api/portal/admin/apps/:id", async (req) => {
    admin(req);
    const id = idParam(req);
    must(db.prepare("SELECT id FROM portal_apps WHERE id = ?").get(id));
    const b = appSchema.parse(req.body);
    checkPlace(b.tabId, b.sectionId);
    db.prepare(
      `UPDATE portal_apps SET tab_id = ?, section_id = ?, name = ?, description_en = ?, description_nl = ?, url = ?, icon = ?, color = ?,
         new_window = ?, check_health = ?, health_url = ?, groups = ? WHERE id = ?`,
    ).run(b.tabId, b.sectionId, b.name, b.descriptionEn, b.descriptionNl, b.url, b.icon, b.color, b.newWindow ? 1 : 0, b.checkHealth ? 1 : 0, b.healthUrl, checkGroups(b.groups), id);
    onAppsChanged?.(id);
    return oneApp(id);
  });
  app.delete("/api/portal/admin/apps/:id", async (req) => {
    admin(req);
    const id = idParam(req);
    const row = db.prepare("SELECT logo FROM portal_apps WHERE id = ?").get(id) as Row | undefined;
    must(row);
    db.prepare("DELETE FROM portal_apps WHERE id = ?").run(id);
    if (row!.logo) rmSync(join(logoDir, String(row!.logo)), { force: true });
    return { ok: true };
  });
  /** New order and place of the buttons on one tab: [{ id, sectionId }] top to bottom. */
  app.put("/api/portal/admin/apps-order", async (req) => {
    admin(req);
    const b = z.object({ tabId: z.number().int(), items: z.array(z.object({ id: z.number().int(), sectionId: z.number().int().nullable() })) }).parse(req.body);
    const existing = (db.prepare("SELECT id FROM portal_apps WHERE tab_id = ?").all(b.tabId) as Row[]).map((r) => Number(r.id));
    if (!sameIds(existing, b.items.map((i) => i.id))) throw new HttpError(400, "order_mismatch");
    for (const i of b.items) checkPlace(b.tabId, i.sectionId);
    const up = db.prepare("UPDATE portal_apps SET sort = ?, section_id = ? WHERE id = ?");
    db.exec("BEGIN");
    b.items.forEach((i, n) => up.run(n, i.sectionId, i.id));
    db.exec("COMMIT");
    return { ok: true };
  });
  app.post("/api/portal/admin/apps/:id/logo", async (req) => {
    admin(req);
    const id = idParam(req);
    const row = db.prepare("SELECT logo FROM portal_apps WHERE id = ?").get(id) as Row | undefined;
    must(row);
    const { dataUrl } = z.object({ dataUrl: z.string().max(1_500_000) }).parse(req.body);
    const m = /^data:image\/(png|svg\+xml|webp|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!m) throw new HttpError(400, "unsupported_image");
    const ext = { png: "png", "svg+xml": "svg", webp: "webp", jpeg: "jpg" }[m[1]!]!;
    const name = `${id}-${Date.now()}.${ext}`;
    writeFileSync(join(logoDir, name), Buffer.from(m[2]!, "base64"));
    db.prepare("UPDATE portal_apps SET logo = ? WHERE id = ?").run(name, id);
    if (row!.logo) rmSync(join(logoDir, String(row!.logo)), { force: true });
    return oneApp(id);
  });
  app.delete("/api/portal/admin/apps/:id/logo", async (req) => {
    admin(req);
    const id = idParam(req);
    const row = db.prepare("SELECT logo FROM portal_apps WHERE id = ?").get(id) as Row | undefined;
    must(row);
    db.prepare("UPDATE portal_apps SET logo = NULL WHERE id = ?").run(id);
    if (row!.logo) rmSync(join(logoDir, String(row!.logo)), { force: true });
    return oneApp(id);
  });

  // Groups
  app.post("/api/portal/admin/groups", async (req) => {
    admin(req);
    const b = groupSchema.parse(req.body);
    if (db.prepare("SELECT id FROM portal_groups WHERE object_id = ?").get(b.objectId)) throw new HttpError(409, "group_exists");
    const r = db.prepare("INSERT INTO portal_groups (name, object_id) VALUES (?, ?)").run(b.name, b.objectId);
    return { id: Number(r.lastInsertRowid), ...b };
  });
  app.put("/api/portal/admin/groups/:id", async (req) => {
    admin(req);
    const id = idParam(req);
    must(db.prepare("SELECT id FROM portal_groups WHERE id = ?").get(id));
    const b = groupSchema.parse(req.body);
    const other = db.prepare("SELECT id FROM portal_groups WHERE object_id = ? AND id != ?").get(b.objectId, id);
    if (other) throw new HttpError(409, "group_exists");
    db.prepare("UPDATE portal_groups SET name = ?, object_id = ? WHERE id = ?").run(b.name, b.objectId, id);
    return { id, ...b };
  });
  app.delete("/api/portal/admin/groups/:id", async (req) => {
    admin(req);
    const id = idParam(req);
    const inUse = [...allTabs(), ...allApps()].filter((x) => x.groups.includes(id)).length;
    if (inUse) throw new HttpError(409, "group_in_use");
    db.prepare("DELETE FROM portal_groups WHERE id = ?").run(id);
    return { ok: true };
  });

  // Notices
  app.post("/api/portal/admin/notices", async (req) => {
    admin(req);
    const b = noticeSchema.parse(req.body);
    const r = db
      .prepare("INSERT INTO portal_notices (text_en, text_nl, level, starts_at, ends_at, created_by) VALUES (?, ?, ?, ?, ?, ?)")
      .run(b.textEn, b.textNl, b.level, b.startsAt, b.endsAt, req.user!.displayName ?? req.user!.username);
    return noticeOut(db.prepare("SELECT * FROM portal_notices WHERE id = ?").get(Number(r.lastInsertRowid)) as Row);
  });
  app.put("/api/portal/admin/notices/:id", async (req) => {
    admin(req);
    const id = idParam(req);
    must(db.prepare("SELECT id FROM portal_notices WHERE id = ?").get(id));
    const b = noticeSchema.parse(req.body);
    db.prepare("UPDATE portal_notices SET text_en = ?, text_nl = ?, level = ?, starts_at = ?, ends_at = ? WHERE id = ?").run(b.textEn, b.textNl, b.level, b.startsAt, b.endsAt, id);
    return noticeOut(db.prepare("SELECT * FROM portal_notices WHERE id = ?").get(id) as Row);
  });
  app.delete("/api/portal/admin/notices/:id", async (req) => {
    admin(req);
    db.prepare("DELETE FROM portal_notices WHERE id = ?").run(idParam(req));
    return { ok: true };
  });

  // Settings
  app.put("/api/portal/admin/settings", async (req) => {
    admin(req);
    const next = settingsSchema.parse(req.body);
    settings.set(SETTINGS_KEY, next);
    onSettingsChanged?.();
    return next;
  });

  // Group membership from the Microsoft sign-in token.
  const rememberGroups = (userId: number, groups: unknown) => {
    db.prepare(
      "INSERT INTO portal_user_groups (user_id, groups, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET groups = excluded.groups, updated_at = excluded.updated_at",
    ).run(userId, JSON.stringify(claimGroups(groups)), new Date().toISOString());
  };

  let onAppsChanged: ((id: number) => void) | undefined;
  let onSettingsChanged: (() => void) | undefined;
  return {
    getSettings,
    rememberGroups,
    /** Apps with a status light: id + address to check. */
    healthTargets: () =>
      (db.prepare("SELECT id, url, health_url FROM portal_apps WHERE check_health = 1").all() as Row[]).map((r) => ({ id: Number(r.id), url: String(r.health_url || r.url) })),
    onAppsChanged: (f: (id: number) => void) => (onAppsChanged = f),
    onSettingsChanged: (f: () => void) => (onSettingsChanged = f),
  };
}
