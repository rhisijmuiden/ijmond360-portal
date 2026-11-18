/**
 * Portal API end to end: tabs, sections, buttons, ordering, favourites, group visibility, notices, logos,
 * status lights (fake probe), Now on TV (local XMLTV server), and Microsoft sign-in with Graph mail and calendar
 * against a local mock identity provider and Graph.
 */
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SignJWT, exportJWK, generateKeyPair } from "jose";

const TENANT = "11111111-2222-3333-4444-555555555555";
const CLIENT = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const SECRET = "client-secret-value";
const TECH = "bbbbbbbb-0000-0000-0000-000000000001";

const root = mkdtempSync(join(tmpdir(), "portal-api-"));
process.env.PORTAL_DATA_DIR = join(root, "data");
process.env.PORTAL_CONF_DIR = join(root, "conf");
process.env.PORTAL_DEFAULT_ADMIN = "admin:local-admin-pass";

const { createPlatform } = await import("@portal/platform");
const { registerPortalApp } = await import("../server/app.ts");
const { PORTAL_MIGRATIONS } = await import("../server/portal.ts");
type Platform = Awaited<ReturnType<typeof createPlatform>>;

// ---- mock Microsoft (identity provider + Graph) and a programme guide ------------------------------------
const { privateKey, publicKey } = await generateKeyPair("RS256");
const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };
let base = "";
let issuer = "";
let next: Record<string, unknown> = {};
let nonce = "";
let lastScope = "";
let refreshCount = 0;
const graphCalls: string[] = [];
let xmltv = "";

const readBody = (req: IncomingMessage) =>
  new Promise<URLSearchParams>((res) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => res(new URLSearchParams(d)));
  });

const mock: Server = createServer(async (req, res) => {
  const url = new URL(req.url!, base);
  const json = (code: number, body: unknown) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (url.pathname === `/${TENANT}/v2.0/.well-known/openid-configuration`)
    return json(200, {
      issuer,
      authorization_endpoint: `${issuer}/oauth2/v2.0/authorize`,
      token_endpoint: `${issuer}/oauth2/v2.0/token`,
      jwks_uri: `${issuer}/discovery/v2.0/keys`,
      response_types_supported: ["code"],
      id_token_signing_alg_values_supported: ["RS256"],
      subject_types_supported: ["pairwise"],
    });
  if (url.pathname === `/${TENANT}/v2.0/discovery/v2.0/keys`) return json(200, { keys: [jwk] });
  if (url.pathname === `/${TENANT}/v2.0/oauth2/v2.0/token`) {
    const body = await readBody(req);
    if (body.get("grant_type") === "refresh_token") {
      if (body.get("refresh_token") !== `rt-${refreshCount}`) return json(400, { error: "invalid_grant" });
      refreshCount++;
      return json(200, { access_token: `at-${refreshCount}`, refresh_token: `rt-${refreshCount}`, token_type: "Bearer", expires_in: 3600 });
    }
    if (body.get("code") !== "good-code") return json(400, { error: "invalid_grant" });
    const idToken = await new SignJWT({ tid: TENANT, nonce, ...next })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(issuer)
      .setAudience(CLIENT)
      .setSubject(String(next.oid))
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    // Expired access token: the first Graph call has to use the refresh token.
    return json(200, { access_token: "at-0", refresh_token: "rt-0", token_type: "Bearer", expires_in: 0, id_token: idToken, scope: lastScope });
  }
  if (url.pathname.startsWith("/graph/")) {
    graphCalls.push(`${req.headers.authorization} ${url.pathname}`);
    if (req.headers.authorization !== `Bearer at-${refreshCount}`) return json(401, { error: { code: "InvalidAuthenticationToken" } });
    if (url.pathname === "/graph/v1.0/me/mailFolders/inbox") return json(200, { unreadItemCount: 3 });
    if (url.pathname === "/graph/v1.0/me/mailFolders/inbox/messages")
      return json(200, { value: [{ id: "m1", subject: "Draaiboek", from: { emailAddress: { name: "Redactie" } }, isRead: false, receivedDateTime: "2026-11-18T19:41:00Z", webLink: "https://outlook.office365.com/owa/?ItemID=m1" }] });
    if (url.pathname === "/graph/v1.0/me/calendarView") {
      assert.equal(req.headers.prefer, 'outlook.timezone="UTC"');
      return json(200, { value: [{ id: "e1", subject: "Redactieoverleg", start: { dateTime: "2026-11-18T08:30:00.0000000" }, end: { dateTime: "2026-11-18T09:00:00.0000000" }, onlineMeeting: { joinUrl: "https://teams.microsoft.com/l/x" } }] });
    }
  }
  if (url.pathname === "/xmltv.xml") {
    res.writeHead(200, { "content-type": "application/xml" });
    return res.end(xmltv);
  }
  json(404, { error: "not_found" });
});
await new Promise<void>((r) => mock.listen(0, "127.0.0.1", r));
base = `http://127.0.0.1:${(mock.address() as { port: number }).port}`;
issuer = `${base}/${TENANT}/v2.0`;
process.env.PORTAL_SSO_AUTHORITY = base;
process.env.PORTAL_GRAPH_URL = `${base}/graph`;

// ---- app under test -------------------------------------------------------------------------------------
let p: Platform;
const probes: string[] = [];
let probeStatus = 200;
const inject = async (method: string, url: string, cookies: Record<string, string>, payload?: unknown) => {
  const res = await p.server.inject({
    method: method as "GET",
    url,
    payload: payload as object,
    headers: { host: "portal.ijmond360.it", "x-forwarded-proto": "https", cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ") },
  });
  for (const c of [res.headers["set-cookie"] ?? []].flat()) {
    const [kv] = String(c).split(";");
    const i = kv!.indexOf("=");
    if (kv!.slice(i + 1)) cookies[kv!.slice(0, i)] = kv!.slice(i + 1);
    else delete cookies[kv!.slice(0, i)];
  }
  return { status: res.statusCode, body: res.body && res.headers["content-type"]?.toString().includes("json") ? JSON.parse(res.body) : res.body, headers: res.headers };
};
const admin: Record<string, string> = {};
let app: ReturnType<typeof registerPortalApp>;

async function signIn(claims: Record<string, unknown>) {
  next = claims;
  const browser: Record<string, string> = {};
  const start = await inject("GET", "/api/auth/sso/login?returnTo=/", browser);
  const auth = new URL(String(start.headers.location));
  lastScope = auth.searchParams.get("scope")!;
  nonce = auth.searchParams.get("nonce")!;
  const cb = await inject("GET", `/api/auth/sso/callback?code=good-code&state=${encodeURIComponent(auth.searchParams.get("state")!)}`, browser);
  assert.equal(cb.headers.location, "/");
  return browser;
}

test.before(async () => {
  p = await createPlatform({
    app: { id: "portal", name: "IJmond 360 Portal", defaultPort: 0 },
    migrations: PORTAL_MIGRATIONS,
    register: (server, platform) => {
      app = registerPortalApp(server, platform, {
        health: false,
        probe: async (url) => {
          probes.push(url);
          return { status: probeStatus, latencyMs: 5 };
        },
      });
    },
  });
  assert.equal((await inject("POST", "/api/auth/login", admin, { username: "admin", password: "local-admin-pass" })).status, 200);
});
test.after(async () => {
  await p.server.close();
  mock.close();
  rmSync(root, { recursive: true, force: true });
});

let tvTab = 0;
let techSection = 0;
let planning = 0;
let orchestrator = 0;
let techGroup = 0;

test("admin builds tabs, sections and buttons; the start tab exists and cannot be deleted", async () => {
  const start = (await inject("GET", "/api/portal/admin", admin)).body;
  const home = start.tabs.find((t: { isHome: boolean }) => t.isHome);
  assert.ok(home);
  assert.equal((await inject("DELETE", `/api/portal/admin/tabs/${home.id}`, admin)).body.error, "home_tab");

  tvTab = (await inject("POST", "/api/portal/admin/tabs", admin, { nameEn: "Television", nameNl: "Televisie", icon: "tv" })).body.id;
  const radio = (await inject("POST", "/api/portal/admin/tabs", admin, { nameEn: "Radio", nameNl: "Radio", icon: "radio" })).body.id;
  assert.equal((await inject("PUT", "/api/portal/admin/tabs-order", admin, { order: [radio, tvTab] })).status, 200);
  assert.equal((await inject("PUT", "/api/portal/admin/tabs-order", admin, { order: [radio] })).body.error, "order_mismatch");
  techSection = (await inject("POST", "/api/portal/admin/sections", admin, { tabId: tvTab, nameEn: "Technology", nameNl: "Techniek" })).body.id;

  const bad = await inject("POST", "/api/portal/admin/apps", admin, { tabId: tvTab, name: "Evil", url: "javascript:alert(1)" });
  assert.equal(bad.status, 400);
  const created = await inject("POST", "/api/portal/admin/apps", admin, {
    tabId: tvTab,
    name: "TV Planning",
    descriptionNl: "Weekplanning en bibliotheek",
    url: "https://tv.ijmond360.loc/",
    icon: "calendar-days",
    color: "pink",
  });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  planning = created.body.id;
  // Saving a button checks its status light right away.
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(probes, ["https://tv.ijmond360.loc/"]);
  const section = await inject("POST", "/api/portal/admin/apps", admin, { tabId: tvTab, sectionId: 999, name: "X", url: "https://x.nl" });
  assert.equal(section.body.error, "unknown_section");
});

test("groups limit who sees a button; Microsoft sign-in stores the user's groups", async () => {
  assert.equal((await inject("POST", "/api/portal/admin/groups", admin, { name: "Techniek", objectId: "not-a-guid" })).status, 400);
  techGroup = (await inject("POST", "/api/portal/admin/groups", admin, { name: "Techniek", objectId: TECH.toUpperCase() })).body.id;
  assert.equal((await inject("POST", "/api/portal/admin/groups", admin, { name: "Dubbel", objectId: TECH })).body.error, "group_exists");
  assert.equal((await inject("POST", "/api/portal/admin/apps", admin, { tabId: tvTab, name: "X", url: "https://x.nl", groups: [12345] })).body.error, "unknown_group");
  orchestrator = (
    await inject("POST", "/api/portal/admin/apps", admin, { tabId: tvTab, sectionId: techSection, name: "Orchestrator", url: "https://orch.ijmond360.loc", groups: [techGroup], healthUrl: "https://orch.ijmond360.loc/api/system/health" })
  ).body.id;
  assert.equal((await inject("DELETE", `/api/portal/admin/groups/${techGroup}`, admin)).body.error, "group_in_use");

  await inject("PUT", "/api/settings/sso", admin, { enabled: true, tenantId: TENANT, clientId: CLIENT, clientSecret: SECRET });
  const jan = await signIn({ oid: "oid-jan", preferred_username: "jan@ijmond360.nl", name: "Jan" });
  // Mail and calendar are on by default, so the sign-in asks for Graph access.
  assert.match(lastScope, /offline_access/);
  assert.match(lastScope, /Mail\.Read/);
  assert.match(lastScope, /Calendars\.Read/);
  let view = (await inject("GET", "/api/portal", jan)).body;
  assert.deepEqual(view.apps.map((a: { name: string }) => a.name), ["TV Planning"]);
  assert.equal(view.apps[0].healthUrl, undefined, "check addresses are not sent to users");
  assert.equal(view.microsoft.signedIn, true);
  assert.equal((await inject("GET", `/api/portal/admin`, jan)).status, 403);

  const piet = await signIn({ oid: "oid-piet", preferred_username: "piet@ijmond360.nl", groups: [TECH] });
  view = (await inject("GET", "/api/portal", piet)).body;
  assert.deepEqual(view.apps.map((a: { name: string }) => a.name).sort(), ["Orchestrator", "TV Planning"]);

  // A group-only tab is hidden with everything on it.
  await inject("PUT", `/api/portal/admin/tabs/${tvTab}`, admin, { nameEn: "Television", nameNl: "Televisie", icon: "tv", groups: [techGroup] });
  view = (await inject("GET", "/api/portal", jan)).body;
  assert.equal(view.tabs.some((t: { id: number }) => t.id === tvTab), false);
  assert.equal(view.apps.length, 0);
  await inject("PUT", `/api/portal/admin/tabs/${tvTab}`, admin, { nameEn: "Television", nameNl: "Televisie", icon: "tv", groups: [] });

  // Favourites: only buttons the user may see are kept.
  const fav = await inject("PUT", "/api/portal/favorites", jan, { appIds: [orchestrator, planning, planning] });
  assert.deepEqual(fav.body.favorites, [planning]);
  assert.deepEqual((await inject("GET", "/api/portal", jan)).body.favorites, [planning]);
});

test("Microsoft 365: mail and calendar through Graph with a rotating refresh token", async () => {
  const jan = await signIn({ oid: "oid-jan", preferred_username: "jan@ijmond360.nl" });
  refreshCount = 0;
  const row = p.ctx.db.prepare("SELECT refresh_token FROM portal_graph_tokens t JOIN users u ON u.id = t.user_id WHERE u.username = 'jan@ijmond360.nl'").get() as { refresh_token: string };
  assert.ok(!row.refresh_token.includes("rt-0"), "refresh token is encrypted at rest");

  const mail = await inject("GET", "/api/portal/m365/mail", jan);
  assert.equal(mail.status, 200, JSON.stringify(mail.body));
  assert.equal(mail.body.unread, 3);
  assert.equal(mail.body.messages[0].subject, "Draaiboek");
  assert.equal(mail.body.messages[0].link, "https://outlook.office365.com/owa/?ItemID=m1");
  assert.equal(refreshCount, 1, "expired access token was refreshed once");

  const cal = await inject("GET", `/api/portal/m365/calendar?from=2026-11-18T00:00:00%2B01:00&to=2026-11-19T00:00:00%2B01:00`, jan);
  assert.equal(cal.status, 200, JSON.stringify(cal.body));
  assert.equal(cal.body.events[0].start, "2026-11-18T08:30:00.000Z");
  assert.equal(cal.body.events[0].joinUrl, "https://teams.microsoft.com/l/x");
  assert.equal(refreshCount, 1, "the new access token is reused");

  // The local admin has no Microsoft connection.
  assert.equal((await inject("GET", "/api/portal/m365/mail", admin)).body.error, "microsoft_not_connected");
  // Turning mail off removes the scope from the next sign-in.
  const s = (await inject("GET", "/api/portal/admin", admin)).body.settings;
  await inject("PUT", "/api/portal/admin/settings", admin, { ...s, m365: { ...s.m365, mail: false } });
  assert.equal((await inject("GET", "/api/portal/m365/mail", jan)).status, 404);
  await signIn({ oid: "oid-jan", preferred_username: "jan@ijmond360.nl" });
  assert.doesNotMatch(lastScope, /Mail\.Read/);
  assert.match(lastScope, /Calendars\.Read/);
});

test("ordering moves buttons between sections", async () => {
  const items = [
    { id: orchestrator, sectionId: null },
    { id: planning, sectionId: techSection },
  ];
  assert.equal((await inject("PUT", "/api/portal/admin/apps-order", admin, { tabId: tvTab, items })).status, 200);
  const apps = (await inject("GET", "/api/portal/admin", admin)).body.apps as { id: number; sectionId: number | null; sort: number }[];
  assert.equal(apps.find((a) => a.id === planning)!.sectionId, techSection);
  assert.equal(apps.find((a) => a.id === orchestrator)!.sort, 0);
  assert.equal((await inject("PUT", "/api/portal/admin/apps-order", admin, { tabId: tvTab, items: items.slice(0, 1) })).body.error, "order_mismatch");
});

test("logos: images only, SVG served without scripts", async () => {
  assert.equal((await inject("POST", `/api/portal/admin/apps/${planning}/logo`, admin, { dataUrl: "data:text/html;base64,PGgxPg==" })).body.error, "unsupported_image");
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><circle r="5"/></svg>').toString("base64");
  const up = await inject("POST", `/api/portal/admin/apps/${planning}/logo`, admin, { dataUrl: `data:image/svg+xml;base64,${svg}` });
  assert.equal(up.status, 200);
  const logo = await inject("GET", up.body.logo, admin);
  assert.equal(logo.headers["content-type"], "image/svg+xml");
  assert.match(String(logo.headers["content-security-policy"]), /sandbox/);
  assert.equal((await inject("DELETE", `/api/portal/admin/apps/${planning}/logo`, admin)).body.logo, null);
});

test("status light results are stored and shown", async () => {
  probeStatus = 503;
  await app.health.runAll();
  const apps = (await inject("GET", "/api/portal", admin)).body.apps as { name: string; health: { status: string } }[];
  assert.equal(apps.find((a) => a.name === "TV Planning")!.health.status, "down");
  assert.ok(probes.includes("https://orch.ijmond360.loc/api/system/health"), "the separate check address is used");
  probeStatus = 200;
});

test("notices: validation and the active window", async () => {
  assert.equal((await inject("POST", "/api/portal/admin/notices", admin, {})).status, 400);
  await inject("POST", "/api/portal/admin/notices", admin, { textNl: "Onderhoud donderdag", level: "warning" });
  await inject("POST", "/api/portal/admin/notices", admin, { textNl: "Later", startsAt: new Date(Date.now() + 3600_000).toISOString() });
  const n = (await inject("GET", "/api/portal", admin)).body.notices;
  assert.deepEqual(n.map((x: { textNl: string }) => x.textNl), ["Onderhoud donderdag"]);
});

test("Now on TV from the XMLTV feed", async () => {
  assert.equal((await inject("GET", "/api/portal/tv", admin)).status, 404);
  const now = Date.now();
  const fmt = (t: number) => new Date(t).toISOString().replace(/[-:T]/g, "").slice(0, 14) + " +0000";
  xmltv = `<tv><channel id="tvsm.1"><display-name>IJmond 360</display-name></channel>
    <programme start="${fmt(now - 600_000)}" stop="${fmt(now + 600_000)}" channel="tvsm.1"><title>Nieuws</title></programme>
    <programme start="${fmt(now + 600_000)}" stop="${fmt(now + 1_800_000)}" channel="tvsm.1"><title>Talkshow</title></programme></tv>`;
  const s = (await inject("GET", "/api/portal/admin", admin)).body.settings;
  await inject("PUT", "/api/portal/admin/settings", admin, { ...s, tv: { ...s.tv, enabled: true, xmltvUrl: `${base}/xmltv.xml?token=secret` } });
  const tv = await inject("GET", "/api/portal/tv", admin);
  assert.equal(tv.status, 200, JSON.stringify(tv.body));
  assert.equal(tv.body.now.title, "Nieuws");
  assert.equal(tv.body.next.title, "Talkshow");
  // The token in the feed address is never sent to users.
  assert.equal(JSON.stringify((await inject("GET", "/api/portal", admin)).body.settings).includes("secret"), false);
});

test("deleting a tab removes its buttons", async () => {
  assert.equal((await inject("DELETE", `/api/portal/admin/tabs/${tvTab}`, admin)).status, 200);
  assert.equal((await inject("GET", "/api/portal/admin", admin)).body.apps.length, 0);
});
