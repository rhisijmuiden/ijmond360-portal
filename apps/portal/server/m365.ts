/**
 * Mail and calendar from Microsoft 365 for the signed-in employee. The Microsoft sign-in also asks for Graph
 * Mail.Read and Calendars.Read (delegated); the refresh token is kept encrypted per user and rotated on every use.
 * Without it (local account, or consent missing) the blocks show a "sign in with Microsoft" hint.
 */
import type { FastifyInstance } from "fastify";
import { HttpError, type Platform } from "@portal/platform";
import { z } from "zod";
import { eventItems, GRAPH_SCOPES, mailItems, type GraphEvent, type GraphMessage } from "./portallogic.js";

const graphBase = () => (process.env.PORTAL_GRAPH_URL ?? "https://graph.microsoft.com").replace(/\/+$/, "");
const CACHE_MS = 60_000;

interface Tokens {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

export class M365 {
  private cache = new Map<string, { at: number; data: unknown }>();
  constructor(
    private platform: Platform,
    private enabled: () => { mail: boolean; calendar: boolean },
  ) {}

  /** Scopes added to the Microsoft sign-in (only when a block is on). */
  scopes() {
    const e = this.enabled();
    return e.mail || e.calendar ? GRAPH_SCOPES.filter((s) => (s === "Mail.Read" ? e.mail : s === "Calendars.Read" ? e.calendar : true)) : [];
  }

  store(userId: number, t: Tokens) {
    if (!t.refresh_token) return;
    const { db, secrets } = this.platform.ctx;
    db.prepare(
      `INSERT INTO portal_graph_tokens (user_id, refresh_token, access_token, expires_at, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET refresh_token = excluded.refresh_token, access_token = excluded.access_token,
         expires_at = excluded.expires_at, updated_at = excluded.updated_at`,
    ).run(userId, secrets.encrypt(t.refresh_token), t.access_token ? secrets.encrypt(t.access_token) : "", Date.now() + (t.expires_in ?? 0) * 1000, new Date().toISOString());
    for (const k of this.cache.keys()) if (k.startsWith(`${userId}:`)) this.cache.delete(k);
  }

  forget(userId: number) {
    this.platform.ctx.db.prepare("DELETE FROM portal_graph_tokens WHERE user_id = ?").run(userId);
  }

  connected(userId: number) {
    return !!this.platform.ctx.db.prepare("SELECT 1 FROM portal_graph_tokens WHERE user_id = ?").get(userId);
  }

  /** One refresh at a time per user: Entra rotates the refresh token, so a second parallel refresh would fail. */
  private refreshing = new Map<number, Promise<string>>();
  private token(userId: number): Promise<string> {
    const running = this.refreshing.get(userId);
    if (running) return running;
    const p = this.tokenNow(userId).finally(() => this.refreshing.delete(userId));
    this.refreshing.set(userId, p);
    return p;
  }

  private async tokenNow(userId: number): Promise<string> {
    const { db, secrets } = this.platform.ctx;
    const row = db.prepare("SELECT * FROM portal_graph_tokens WHERE user_id = ?").get(userId) as
      | { refresh_token: string; access_token: string; expires_at: number }
      | undefined;
    if (!row) throw new HttpError(409, "microsoft_not_connected");
    if (row.access_token && row.expires_at - Date.now() > 60_000) return secrets.decrypt(row.access_token);
    let next: Tokens;
    try {
      next = await this.platform.sso.refresh(secrets.decrypt(row.refresh_token), this.scopes().join(" "));
    } catch (err) {
      const code = (err as { error?: string }).error;
      // Revoked, expired or consent withdrawn: the user signs in again.
      if (code === "invalid_grant" || code === "interaction_required" || code === "consent_required") {
        this.platform.ctx.log.warn({ err }, "Microsoft 365: refresh token rejected, user must sign in again");
        this.forget(userId);
        throw new HttpError(409, "microsoft_not_connected");
      }
      this.platform.ctx.log.warn({ err }, "Microsoft 365: token refresh failed");
      throw new HttpError(502, "microsoft_unreachable");
    }
    this.store(userId, { ...next, refresh_token: next.refresh_token ?? secrets.decrypt(row.refresh_token) });
    return next.access_token!;
  }

  private async graph<T>(userId: number, path: string, headers: Record<string, string> = {}): Promise<T> {
    const res = await fetch(`${graphBase()}${path}`, {
      headers: { Authorization: `Bearer ${await this.token(userId)}`, Accept: "application/json", ...headers },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 401 || res.status === 403) throw new HttpError(409, res.status === 403 ? "microsoft_consent_missing" : "microsoft_not_connected");
    if (!res.ok) throw new HttpError(502, "microsoft_unreachable");
    return (await res.json()) as T;
  }

  private async cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.data as T;
    const data = await load();
    this.cache.set(key, { at: Date.now(), data });
    if (this.cache.size > 2000) this.cache.delete(this.cache.keys().next().value!);
    return data;
  }

  mail(userId: number) {
    return this.cached(`${userId}:mail`, async () => {
      const [folder, list] = await Promise.all([
        this.graph<{ unreadItemCount?: number }>(userId, "/v1.0/me/mailFolders/inbox?$select=unreadItemCount"),
        this.graph<{ value: GraphMessage[] }>(
          userId,
          "/v1.0/me/mailFolders/inbox/messages?$top=6&$select=subject,from,receivedDateTime,isRead,webLink,bodyPreview&$orderby=receivedDateTime%20desc",
        ),
      ]);
      return { unread: folder.unreadItemCount ?? 0, messages: mailItems(list.value ?? []) };
    });
  }

  calendar(userId: number, from: string, to: string) {
    return this.cached(`${userId}:cal:${from}:${to}`, async () => {
      const q = new URLSearchParams({
        startDateTime: from,
        endDateTime: to,
        $select: "subject,start,end,isAllDay,isCancelled,location,isOnlineMeeting,onlineMeeting,webLink,showAs",
        $orderby: "start/dateTime",
        $top: "20",
      });
      const list = await this.graph<{ value: GraphEvent[] }>(userId, `/v1.0/me/calendarView?${q}`, { Prefer: 'outlook.timezone="UTC"' });
      return { events: eventItems(list.value ?? []) };
    });
  }
}

export function registerM365(app: FastifyInstance, m365: M365, enabled: () => { mail: boolean; calendar: boolean }) {
  app.get("/api/portal/m365/mail", async (req) => {
    if (!enabled().mail) throw new HttpError(404, "disabled");
    return m365.mail(req.user!.id);
  });
  app.get("/api/portal/m365/calendar", async (req) => {
    if (!enabled().calendar) throw new HttpError(404, "disabled");
    const q = z.object({ from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }) }).parse(req.query);
    const from = Date.parse(q.from);
    const to = Date.parse(q.to);
    if (to <= from || to - from > 8 * 86400_000) throw new HttpError(400, "invalid_range");
    return m365.calendar(req.user!.id, new Date(from).toISOString(), new Date(to).toISOString());
  });
  app.get("/api/portal/m365/status", async (req) => ({ connected: m365.connected(req.user!.id), ...enabled() }));
}
