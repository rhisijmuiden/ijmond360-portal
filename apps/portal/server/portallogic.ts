/**
 * Pure portal rules: input schemas, who sees what, health classification, notices, programme guide (XMLTV) now/next
 * and Microsoft Graph result shaping. No database or network here, so everything is unit tested.
 */
import { z } from "zod";

export const COLORS = ["purple", "pink", "blue", "green", "orange", "ink"] as const;
export type TileColor = (typeof COLORS)[number];

const text = (max: number) => z.string().trim().max(max);
/** Ids of portal groups (portal_groups.id). Empty = everyone. */
const groupIds = z.array(z.number().int().positive()).max(50).default([]);

export const tabSchema = z.object({
  nameEn: text(60).min(1),
  nameNl: text(60).default(""),
  icon: text(40).default("layout-grid"),
  groups: groupIds,
});
export type TabInput = z.infer<typeof tabSchema>;

export const sectionSchema = z.object({
  tabId: z.number().int().positive(),
  nameEn: text(60).min(1),
  nameNl: text(60).default(""),
});
export type SectionInput = z.infer<typeof sectionSchema>;

/** http(s) only: no javascript:, data: or file: links on a button. */
export const linkSchema = z
  .string()
  .trim()
  .max(2000)
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === "https:" || u.protocol === "http:";
    } catch {
      return false;
    }
  }, "http_url_required");

export const appSchema = z.object({
  tabId: z.number().int().positive(),
  sectionId: z.number().int().positive().nullable().default(null),
  name: text(60).min(1),
  descriptionEn: text(240).default(""),
  descriptionNl: text(240).default(""),
  url: linkSchema,
  icon: text(40).default("app-window"),
  color: z.enum(COLORS).default("purple"),
  newWindow: z.boolean().default(true),
  checkHealth: z.boolean().default(true),
  /** Address checked for the status light; empty = the link itself. */
  healthUrl: z.union([linkSchema, z.literal("")]).default(""),
  groups: groupIds,
});
export type AppInput = z.infer<typeof appSchema>;

export const groupSchema = z.object({
  name: text(80).min(1),
  /** Entra group object ID (GUID), as in the groups claim of the sign-in token. */
  objectId: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, "object_id_guid"),
});

export const NOTICE_LEVELS = ["info", "warning", "success"] as const;
export const noticeSchema = z
  .object({
    textEn: text(400).default(""),
    textNl: text(400).default(""),
    level: z.enum(NOTICE_LEVELS).default("info"),
    startsAt: z.iso.datetime({ offset: true }).nullable().default(null),
    endsAt: z.iso.datetime({ offset: true }).nullable().default(null),
  })
  .refine((n) => n.textEn || n.textNl, { message: "text_required" })
  .refine((n) => !n.startsAt || !n.endsAt || Date.parse(n.endsAt) > Date.parse(n.startsAt), { message: "ends_before_start" });

export const settingsSchema = z.object({
  /** Shown in the browser tab and on the login page. */
  title: text(60).default("IJmond 360 Portal"),
  m365: z
    .object({
      mail: z.boolean().default(true),
      calendar: z.boolean().default(true),
      /** Outlook on the web, opened from the mail and calendar blocks. */
      outlookUrl: z.union([linkSchema, z.literal("")]).default("https://outlook.office.com/mail/"),
      calendarUrl: z.union([linkSchema, z.literal("")]).default("https://outlook.office.com/calendar/"),
    })
    .default({ mail: true, calendar: true, outlookUrl: "https://outlook.office.com/mail/", calendarUrl: "https://outlook.office.com/calendar/" }),
  tv: z
    .object({
      enabled: z.boolean().default(false),
      /** XMLTV feed of TV Station Manager (EPG page, with token). */
      xmltvUrl: z.union([linkSchema, z.literal("")]).default(""),
      /** XMLTV channel id (e.g. "tvsm.1"); empty = the first channel in the feed. */
      channel: text(80).default(""),
      /** Video for the preview: an Owncast /embed/video page, .m3u8 or .mp4. Empty = no preview. */
      streamUrl: z.union([linkSchema, z.literal("")]).default(""),
      /** Opened from the block (e.g. TV Station Manager "Now on TV"). */
      linkUrl: z.union([linkSchema, z.literal("")]).default(""),
    })
    .default({ enabled: false, xmltvUrl: "", channel: "", streamUrl: "", linkUrl: "" }),
});
export type PortalSettings = z.infer<typeof settingsSchema>;

/** Settings without the XMLTV token, for every signed-in user. */
export function publicSettings(s: PortalSettings) {
  return { title: s.title, m365: s.m365, tv: { enabled: s.tv.enabled && !!s.tv.xmltvUrl, streamUrl: s.tv.streamUrl, linkUrl: s.tv.linkUrl } };
}

// ---- who sees what ---------------------------------------------------------------------------------------

export interface Viewer {
  isAdmin: boolean;
  /** Entra group object IDs from the user's last Microsoft sign-in (lower case). */
  groupObjectIds: string[];
}

/**
 * True when the viewer may see an item restricted to `itemGroups` (portal group ids). No groups = everyone.
 * Admins see everything (they manage it). A group whose object id is unknown never matches.
 */
export function canSee(itemGroups: number[], groupObjectId: Map<number, string>, viewer: Viewer) {
  if (viewer.isAdmin || itemGroups.length === 0) return true;
  const mine = new Set(viewer.groupObjectIds.map((g) => g.toLowerCase()));
  return itemGroups.some((id) => {
    const oid = groupObjectId.get(id);
    return !!oid && mine.has(oid);
  });
}

export const parseIds = (json: unknown): number[] => {
  try {
    const v = JSON.parse(String(json ?? "[]"));
    return Array.isArray(v) ? v.filter((x): x is number => Number.isInteger(x) && x > 0) : [];
  } catch {
    return [];
  }
};

/** Group object ids from the token: the `groups` claim (GUIDs only, lower case, max 500). */
export function claimGroups(groups: unknown): string[] {
  if (!Array.isArray(groups)) return [];
  return [...new Set(groups.filter((g): g is string => typeof g === "string" && /^[0-9a-f-]{36}$/i.test(g)).map((g) => g.toLowerCase()))].slice(0, 500);
}

// ---- status light ----------------------------------------------------------------------------------------

export type Health = "up" | "down" | "unknown";

/**
 * Any HTTP answer below 500 means the app is there (a login page, 401 or a redirect included); 5xx or no answer is down.
 */
export function classify(result: { status?: number; error?: string }): Health {
  if (result.error || result.status === undefined) return "down";
  return result.status < 500 ? "up" : "down";
}

// ---- notices ---------------------------------------------------------------------------------------------

export interface NoticeRow {
  id: number;
  textEn: string;
  textNl: string;
  level: string;
  startsAt: string | null;
  endsAt: string | null;
}

export const activeNotices = <T extends Pick<NoticeRow, "startsAt" | "endsAt">>(rows: T[], now: number) =>
  rows.filter((n) => (!n.startsAt || Date.parse(n.startsAt) <= now) && (!n.endsAt || Date.parse(n.endsAt) > now));

/** The text in the user's language, else the other one. */
export const pick = (lang: string, en: string, nl: string) => (lang === "nl" ? nl || en : en || nl);

// ---- ordering --------------------------------------------------------------------------------------------

/** Validates a new order: exactly the existing ids, each once. */
export function sameIds(existing: number[], order: number[]) {
  if (existing.length !== order.length) return false;
  const set = new Set(order);
  return set.size === order.length && existing.every((id) => set.has(id));
}

// ---- programme guide (XMLTV) -----------------------------------------------------------------------------

export interface Programme {
  channel: string;
  start: number;
  stop: number;
  title: string;
  description?: string;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
export const xmlText = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .trim();

/** XMLTV time "20261118203000 +0100" (offset optional = UTC). */
export function xmltvTime(v: string): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-])?(\d{2})?(\d{2})?/.exec(v.trim());
  if (!m) return null;
  const utc = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +(m[6] ?? 0));
  const off = m[7] ? (m[7] === "-" ? -1 : 1) * (+(m[8] ?? 0) * 60 + +(m[9] ?? 0)) : 0;
  return utc - off * 60_000;
}

const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

export function parseXmltv(xml: string): { channels: { id: string; name: string }[]; programmes: Programme[] } {
  const channels: { id: string; name: string }[] = [];
  for (const m of xml.matchAll(/<channel\b([^>]*)>([\s\S]*?)<\/channel>/g)) {
    const id = attr(m[1]!, "id");
    if (!id) continue;
    const name = /<display-name\b[^>]*>([\s\S]*?)<\/display-name>/.exec(m[2]!)?.[1];
    channels.push({ id: xmlText(id), name: name ? xmlText(name) : xmlText(id) });
  }
  const programmes: Programme[] = [];
  for (const m of xml.matchAll(/<programme\b([^>]*)>([\s\S]*?)<\/programme>/g)) {
    const start = xmltvTime(attr(m[1]!, "start") ?? "");
    const stop = xmltvTime(attr(m[1]!, "stop") ?? "");
    const channel = attr(m[1]!, "channel");
    const title = /<title\b[^>]*>([\s\S]*?)<\/title>/.exec(m[2]!)?.[1];
    if (start === null || stop === null || !channel || !title || stop <= start) continue;
    const desc = /<desc\b[^>]*>([\s\S]*?)<\/desc>/.exec(m[2]!)?.[1];
    programmes.push({ channel: xmlText(channel), start, stop, title: xmlText(title), description: desc ? xmlText(desc) : undefined });
  }
  return { channels, programmes };
}

/** What is on now and what comes next on a channel (empty channel = the first one in the feed). */
export function nowNext(guide: ReturnType<typeof parseXmltv>, channel: string, now: number) {
  const ch = channel || guide.channels[0]?.id || guide.programmes[0]?.channel || "";
  const list = guide.programmes.filter((p) => p.channel === ch).sort((a, b) => a.start - b.start);
  const current = list.find((p) => p.start <= now && p.stop > now) ?? null;
  const next = list.find((p) => p.start >= (current?.stop ?? now)) ?? null;
  const out = (p: Programme | null) => (p ? { title: p.title, description: p.description ?? null, start: new Date(p.start).toISOString(), stop: new Date(p.stop).toISOString() } : null);
  return { channel: ch, channelName: guide.channels.find((c) => c.id === ch)?.name ?? null, now: out(current), next: out(next) };
}

// ---- Microsoft Graph -------------------------------------------------------------------------------------

export const GRAPH_SCOPES = ["offline_access", "User.Read", "Mail.Read", "Calendars.Read"];

export interface GraphMessage {
  id: string;
  subject?: string | null;
  from?: { emailAddress?: { name?: string; address?: string } } | null;
  receivedDateTime?: string;
  isRead?: boolean;
  webLink?: string;
  bodyPreview?: string;
}

export const mailItems = (messages: GraphMessage[]) =>
  messages.map((m) => ({
    id: m.id,
    subject: m.subject || "",
    from: m.from?.emailAddress?.name || m.from?.emailAddress?.address || "",
    receivedAt: m.receivedDateTime ?? null,
    unread: m.isRead === false,
    preview: (m.bodyPreview ?? "").slice(0, 140),
    // Only Outlook links: never pass on other URLs from the mailbox.
    link: safeOutlookLink(m.webLink),
  }));

export interface GraphEvent {
  id: string;
  subject?: string | null;
  start?: { dateTime: string; timeZone?: string };
  end?: { dateTime: string; timeZone?: string };
  isAllDay?: boolean;
  isCancelled?: boolean;
  location?: { displayName?: string } | null;
  isOnlineMeeting?: boolean;
  onlineMeeting?: { joinUrl?: string } | null;
  webLink?: string;
  showAs?: string;
}

/** Graph returns times in UTC when asked with Prefer: outlook.timezone="UTC" (without a Z). */
const utcIso = (v?: string) => (v ? new Date(/[zZ]|[+-]\d{2}:\d{2}$/.test(v) ? v : `${v}Z`).toISOString() : null);

export const eventItems = (events: GraphEvent[]) =>
  events
    .filter((e) => !e.isCancelled)
    .map((e) => ({
      id: e.id,
      subject: e.subject || "",
      start: utcIso(e.start?.dateTime),
      end: utcIso(e.end?.dateTime),
      allDay: !!e.isAllDay,
      location: e.location?.displayName || "",
      joinUrl: safeTeamsLink(e.onlineMeeting?.joinUrl),
      link: safeOutlookLink(e.webLink),
    }));

const hostIn = (v: string | undefined, hosts: RegExp) => {
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && hosts.test(u.hostname) ? u.href : null;
  } catch {
    return null;
  }
};
export const safeOutlookLink = (v?: string) => hostIn(v, /^(outlook\.(office|office365|live)\.com|outlook\.cloud\.microsoft)$/i);
export const safeTeamsLink = (v?: string) => hostIn(v, /^teams\.(microsoft|live)\.com$/i);
