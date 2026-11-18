import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { PlatformContext } from "./context.js";
import { HttpError, isUnder, requestPaths } from "./context.js";
import { hashPassword, randomToken, verifyPassword } from "./crypto.js";
import { SSO_PUBLIC_PATHS, SsoService, registerSso } from "./sso.js";

export const SESSION_COOKIE = "portal_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export interface SessionUser {
  id: number;
  username: string;
  displayName: string | null;
  email: string | null;
  role: string;
  language: string;
  /** "local" (password) or "entra" (Microsoft sign-in). */
  authProvider: string;
}

declare module "fastify" {
  interface FastifyRequest {
    user?: SessionUser;
  }
}

const PUBLIC_API = new Set(["/api/auth/status", "/api/auth/setup", "/api/auth/login", "/api/system/health", ...SSO_PUBLIC_PATHS]);

/**
 * Failed password sign-ins are counted per address + user name (10 in 15 minutes) and per user name from anywhere
 * (50 in 15 minutes, against guessing from many addresses); above that the login answers 429 until the window passes.
 * A successful sign-in clears the address + user name counter.
 */
const LOGIN_WINDOW_MS = 15 * 60_000;
const LOGIN_LIMITS = { pair: 10, user: 50 };
export class LoginThrottle {
  private fails = new Map<string, number[]>();
  constructor(private now: () => number = Date.now) {}
  private recent(key: string) {
    const t = this.now();
    const list = (this.fails.get(key) ?? []).filter((at) => t - at < LOGIN_WINDOW_MS);
    if (list.length) this.fails.set(key, list);
    else this.fails.delete(key);
    return list;
  }
  private keys(ip: string, username: string) {
    const u = username.trim().toLowerCase();
    return { pair: `p:${ip}|${u}`, user: `u:${u}` };
  }
  blocked(ip: string, username: string) {
    const k = this.keys(ip, username);
    return this.recent(k.pair).length >= LOGIN_LIMITS.pair || this.recent(k.user).length >= LOGIN_LIMITS.user;
  }
  failed(ip: string, username: string) {
    const k = this.keys(ip, username);
    for (const key of [k.pair, k.user]) this.fails.set(key, [...this.recent(key), this.now()]);
    // Keeps memory bounded when someone sprays many names.
    if (this.fails.size > 10_000) for (const key of [...this.fails.keys()].slice(0, 5_000)) this.fails.delete(key);
  }
  succeeded(ip: string, username: string) {
    this.fails.delete(this.keys(ip, username).pair);
  }
}

const credentials = z.object({ username: z.string().trim().min(3).max(64), password: z.string().min(10).max(256) });

function userCount(ctx: PlatformContext) {
  return (ctx.db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
}

function loadSession(ctx: PlatformContext, token: string | undefined): SessionUser | undefined {
  if (!token) return undefined;
  const row = ctx.db
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.email, u.role, u.language, u.auth_provider, s.expires_at
         FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`,
    )
    .get(token) as Record<string, unknown> | undefined;
  if (!row || Number(row.expires_at) < Date.now()) return undefined;
  // Sliding expiry.
  ctx.db.prepare("UPDATE sessions SET expires_at = ? WHERE token = ?").run(Date.now() + SESSION_TTL_MS, token);
  return {
    id: Number(row.id),
    username: String(row.username),
    displayName: (row.display_name as string) ?? null,
    email: (row.email as string) ?? null,
    role: String(row.role),
    language: String(row.language),
    authProvider: String(row.auth_provider ?? "local"),
  };
}

const DEFAULT_FLAG = "auth.defaultPasswordInUse";
const DEFAULT_USER = "auth.defaultAdminUser";

function defaultAdminSpec() {
  const spec = process.env.PORTAL_DEFAULT_ADMIN ?? "admin:admin";
  if (spec === "off") return null;
  const i = spec.indexOf(":");
  return { username: i > 0 ? spec.slice(0, i) : "admin", password: i > 0 ? spec.slice(i + 1) : spec };
}

/** Remembers the last checked hash so the scrypt check runs once per password change, not on every status call. */
let defaultCheck: { hash: string; isDefault: boolean } | null = null;

/**
 * Which local account still has the default password, or null.
 * Checks the real password hash, so the warning also disappears when the password was changed some
 * other way (admin reset on the Users page, reset on the server) or the account was removed.
 */
async function accountWithDefaultPassword(ctx: PlatformContext): Promise<string | null> {
  if (!ctx.settings.get(DEFAULT_FLAG, false)) return null;
  const spec = defaultAdminSpec();
  const username = ctx.settings.get<string | null>(DEFAULT_USER, null) ?? spec?.username ?? "admin";
  const row = ctx.db.prepare("SELECT password_hash, auth_provider FROM users WHERE username = ?").get(username) as
    | { password_hash: string; auth_provider: string | null }
    | undefined;
  let isDefault = false;
  if (spec && row && (row.auth_provider ?? "local") === "local") {
    if (defaultCheck?.hash !== row.password_hash) defaultCheck = { hash: row.password_hash, isDefault: await verifyPassword(spec.password, row.password_hash) };
    isDefault = defaultCheck.isDefault;
  }
  if (!isDefault) ctx.settings.set(DEFAULT_FLAG, false);
  return isDefault ? username : null;
}

/**
 * Creates the default administrator on first start (no users yet).
 * PORTAL_DEFAULT_ADMIN="user:password" overrides the credentials, "off" disables it (first-run setup page instead).
 */
export async function ensureDefaultAdmin(ctx: PlatformContext) {
  const spec = defaultAdminSpec();
  if (!spec || userCount(ctx) > 0) return;
  const { username, password } = spec;
  ctx.db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')").run(username, await hashPassword(password));
  ctx.settings.set(DEFAULT_FLAG, true);
  ctx.settings.set(DEFAULT_USER, username);
  ctx.log.warn({ username }, "created default administrator account; change its password after the first login");
}

export function registerAuth(app: FastifyInstance, ctx: PlatformContext, sso = new SsoService(ctx), throttle = new LoginThrottle()) {
  const startSession = (userId: number) => {
    const token = randomToken();
    ctx.db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)").run(token, userId, Date.now() + SESSION_TTL_MS);
    ctx.db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
    return token;
  };
  const cookieOpts = (req: FastifyRequest) => ({
    path: "/",
    httpOnly: true,
    sameSite: "strict" as const,
    secure: req.protocol === "https",
    maxAge: SESSION_TTL_MS / 1000,
  });

  registerSso(app, ctx, sso, (req, reply, userId) => reply.setCookie(SESSION_COOKIE, startSession(userId), cookieOpts(req)));

  app.addHook("onRequest", async (req) => {
    // Checked on the routed path: "/%61pi/users" reaches the same handler as "/api/users".
    if (!isUnder(req, "/api/")) return;
    req.user = loadSession(ctx, req.cookies[SESSION_COOKIE]);
    const { route, decoded } = requestPaths(req);
    const isPublic = route ? PUBLIC_API.has(route) && PUBLIC_API.has(decoded) : PUBLIC_API.has(decoded);
    if (!req.user && !isPublic) throw new HttpError(401, "unauthorized");
  });

  app.get("/api/auth/status", async (req) => {
    // Only administrators can do something about it, so only they get the warning.
    const defaultAccount = req.user?.role === "admin" ? await accountWithDefaultPassword(ctx) : null;
    return {
      setupRequired: userCount(ctx) === 0,
      user: req.user ?? null,
      defaultPasswordInUse: req.user ? defaultAccount !== null : undefined,
      defaultPasswordAccount: defaultAccount ?? undefined,
      sso: sso.isEnabled() ? { provider: "entra", label: sso.getConfig().buttonLabel || null } : null,
    };
  });

  app.post("/api/auth/setup", async (req, reply) => {
    if (userCount(ctx) > 0) throw new HttpError(409, "already_set_up");
    const body = credentials.extend({ email: z.email().optional(), language: z.enum(["en", "nl"]).default("en") }).parse(req.body);
    const hash = await hashPassword(body.password);
    const res = ctx.db
      .prepare("INSERT INTO users (username, password_hash, email, role, language) VALUES (?, ?, ?, 'admin', ?)")
      .run(body.username, hash, body.email ?? null, body.language);
    reply.setCookie(SESSION_COOKIE, startSession(Number(res.lastInsertRowid)), cookieOpts(req));
    return { ok: true };
  });

  app.post("/api/auth/login", async (req, reply) => {
    const body = z.object({ username: z.string(), password: z.string() }).parse(req.body);
    if (throttle.blocked(req.ip, body.username)) {
      ctx.log.warn({ username: body.username, ip: req.ip }, "sign-in held back after too many failed attempts");
      throw new HttpError(429, "too_many_attempts");
    }
    // Microsoft accounts have no password; they only sign in through SSO.
    const row = ctx.db.prepare("SELECT id, password_hash FROM users WHERE username = ? AND auth_provider = 'local'").get(body.username) as
      | { id: number; password_hash: string }
      | undefined;
    // Always run a hash comparison to keep timing similar for unknown users.
    const ok = await verifyPassword(body.password, row?.password_hash ?? "scrypt$AAAA$AAAA");
    if (!row || !ok) {
      throttle.failed(req.ip, body.username);
      throw new HttpError(401, "invalid_credentials");
    }
    throttle.succeeded(req.ip, body.username);
    reply.setCookie(SESSION_COOKIE, startSession(row.id), cookieOpts(req));
    return { ok: true };
  });

  app.post("/api/auth/logout", async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) ctx.db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.put("/api/auth/profile", async (req) => {
    const body = z
      .object({ displayName: z.string().max(120).nullable().optional(), email: z.email().nullable().optional(), language: z.enum(["en", "nl"]).optional() })
      .parse(req.body);
    const u = req.user!;
    ctx.db
      .prepare("UPDATE users SET display_name = ?, email = ?, language = ? WHERE id = ?")
      .run(body.displayName ?? u.displayName, body.email ?? u.email, body.language ?? u.language, u.id);
    return { ok: true };
  });

  app.put("/api/auth/password", async (req) => {
    const body = z.object({ current: z.string(), next: z.string().min(10).max(256) }).parse(req.body);
    if (req.user!.authProvider !== "local") throw new HttpError(400, "sso_account");
    const row = ctx.db.prepare("SELECT password_hash FROM users WHERE id = ?").get(req.user!.id) as { password_hash: string };
    if (!(await verifyPassword(body.current, row.password_hash))) throw new HttpError(400, "invalid_current_password");
    ctx.db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(await hashPassword(body.next), req.user!.id);
    ctx.settings.set(DEFAULT_FLAG, false);
    ctx.db.prepare("DELETE FROM sessions WHERE user_id = ? AND token != ?").run(req.user!.id, req.cookies[SESSION_COOKIE] ?? "");
    return { ok: true };
  });
}
