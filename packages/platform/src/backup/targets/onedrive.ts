import { createWriteStream, statSync } from "node:fs";
import { open } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { BackupTarget, OneDriveConfig, RemoteFile, TargetHooks } from "./types.js";

/**
 * OneDrive / OneDrive for Business target over Microsoft Graph. The administrator signs in once with the device-code
 * flow ("go to microsoft.com/devicelogin and type this code"); we keep only the refresh token (encrypted) and rotate it.
 * Scopes are delegated `Files.ReadWrite offline_access User.Read`: the app can only reach that account's own drive.
 */

export const ONEDRIVE_SCOPES = "Files.ReadWrite offline_access User.Read";
const loginBase = () => (process.env.PORTAL_SSO_AUTHORITY ?? "https://login.microsoftonline.com").replace(/\/+$/, "");
const graphBase = () => (process.env.PORTAL_GRAPH_URL ?? "https://graph.microsoft.com/v1.0").replace(/\/+$/, "");
/** Graph upload sessions want chunks in multiples of 320 KiB; 10 MiB = 32 x 320 KiB. */
export const CHUNK = 320 * 1024 * 32;
const SIMPLE_MAX = 4 * 1024 * 1024;

/** Graph path of the backup folder, each segment URL-encoded ("" = drive root). */
export function folderPath(folder: string): string {
  const parts = folder.split(/[\\/]+/).filter(Boolean);
  if (parts.some((p) => p === ".." || p === ".")) throw new Error("OneDrive folder may not contain . or ..");
  return parts.map(encodeURIComponent).join("/");
}

/** Graph item address for a file (or the folder itself when `name` is omitted). */
export function itemUrl(folder: string, name?: string): string {
  const path = [folderPath(folder), name ? encodeURIComponent(name) : ""].filter(Boolean).join("/");
  return path ? `${graphBase()}/me/drive/root:/${path}:` : `${graphBase()}/me/drive/root`;
}

/** Byte ranges for an upload session. */
export function chunkRanges(size: number, chunk = CHUNK): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  for (let start = 0; start < size; start += chunk) out.push({ start, end: Math.min(size, start + chunk) - 1 });
  return out;
}

interface TokenSet {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

async function tokenRequest(tenant: string, body: Record<string, string>) {
  const res = await fetch(`${loginBase()}/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const json = (await res.json().catch(() => ({}))) as TokenSet & { error?: string; error_description?: string };
  return { ok: res.ok, json };
}

// ---- device-code sign-in ------------------------------------------------------

export interface DeviceCodeStart {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
  message: string;
}

export async function startDeviceCode(tenant: string, clientId: string): Promise<DeviceCodeStart> {
  const res = await fetch(`${loginBase()}/${encodeURIComponent(tenant)}/oauth2/v2.0/devicecode`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, scope: ONEDRIVE_SCOPES }),
  });
  const json = (await res.json().catch(() => ({}))) as DeviceCodeStart & { error?: string; error_description?: string };
  if (!res.ok || !json.device_code) throw new Error(friendlyAuthError(json.error, json.error_description));
  return json;
}

export type DevicePoll = { status: "pending" } | { status: "done"; refreshToken: string; accessToken: string } | { status: "error"; error: string };

export async function pollDeviceCode(tenant: string, clientId: string, deviceCode: string): Promise<DevicePoll> {
  const { ok, json } = await tokenRequest(tenant, { grant_type: "urn:ietf:params:oauth:grant-type:device_code", client_id: clientId, device_code: deviceCode });
  if (ok && json.refresh_token) return { status: "done", refreshToken: json.refresh_token, accessToken: json.access_token };
  if (json.error === "authorization_pending" || json.error === "slow_down") return { status: "pending" };
  return { status: "error", error: friendlyAuthError(json.error, json.error_description) };
}

/** Short, actionable messages for the errors an administrator is likely to hit. */
export function friendlyAuthError(code?: string, description?: string): string {
  const aad = /AADSTS\d+/.exec(description ?? "")?.[0];
  const hints: Record<string, string> = {
    AADSTS7000218: 'turn on "Allow public client flows" in the app registration (Authentication)',
    AADSTS700016: "application (client) ID not found in this tenant",
    AADSTS90002: "tenant not found",
    AADSTS65001: "admin consent for Files.ReadWrite is missing",
    AADSTS70000: "the sign-in was not accepted",
  };
  if (code === "expired_token") return "the code expired, start the sign-in again";
  if (code === "authorization_declined") return "the sign-in was cancelled";
  if (code === "invalid_grant") return `Microsoft sign-in is no longer valid, connect OneDrive again${aad ? ` (${aad})` : ""}`;
  if (aad && hints[aad]) return `Microsoft: ${hints[aad]} (${aad})`;
  return `Microsoft: ${(description ?? code ?? "sign-in failed").split("\n")[0]}`;
}

// ---- target ---------------------------------------------------------------------

/** Access tokens per account, shared between target instances (the engine creates one per operation). */
const tokenCache = new Map<string, { access: string; expires: number; refresh: string }>();
/** Refreshes in flight per account: Microsoft rotates refresh tokens, so two parallel refreshes would burn each other's token. */
const refreshing = new Map<string, Promise<string>>();
export const _clearOneDriveTokenCache = () => {
  tokenCache.clear();
  refreshing.clear();
};
/** Upload/download attempts after a dropped connection or server error before giving up. */
export const MAX_ATTEMPTS = 5;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Backoff between attempts; tests set PORTAL_GRAPH_BACKOFF_MS=1. */
const backoff = (attempt: number) => Math.min(30_000, (Number(process.env.PORTAL_GRAPH_BACKOFF_MS) || 1000) * 2 ** attempt);

export class OneDriveTarget implements BackupTarget {
  constructor(private cfg: OneDriveConfig, private hooks: TargetHooks = {}) {}

  private cacheKey() {
    return `${this.cfg.tenant}|${this.cfg.clientId}|${this.cfg.account}`;
  }

  private async accessToken(): Promise<string> {
    if (!this.cfg.refreshToken) throw new Error("OneDrive is not connected yet: click Connect to Microsoft");
    const key = this.cacheKey();
    const hit = tokenCache.get(key);
    if (hit && hit.expires > Date.now() + 60_000) return hit.access;
    const inflight = refreshing.get(key);
    if (inflight) return inflight;
    const p = this.refreshAccess(key).finally(() => refreshing.delete(key));
    refreshing.set(key, p);
    return p;
  }

  private async refreshAccess(key: string): Promise<string> {
    const hit = tokenCache.get(key);
    const refresh = hit?.refresh ?? this.cfg.refreshToken;
    const { ok, json } = await tokenRequest(this.cfg.tenant, {
      grant_type: "refresh_token",
      client_id: this.cfg.clientId,
      refresh_token: refresh,
      scope: ONEDRIVE_SCOPES,
    });
    if (!ok || !json.access_token) throw new Error(friendlyAuthError(json.error, (json as { error_description?: string }).error_description));
    const next = json.refresh_token ?? refresh;
    tokenCache.set(key, { access: json.access_token, expires: Date.now() + json.expires_in * 1000, refresh: next });
    if (next !== this.cfg.refreshToken) {
      this.cfg.refreshToken = next;
      this.hooks.saveConfig?.({ refreshToken: next });
    }
    return json.access_token;
  }

  /** Graph call with bearer token; retries throttling (429/503) honouring Retry-After. */
  private async graph(url: string, init: RequestInit & { auth?: boolean } = {}, attempt = 0): Promise<Response> {
    const headers = new Headers(init.headers);
    if (init.auth !== false) headers.set("authorization", `Bearer ${await this.accessToken()}`);
    let res: Response;
    try {
      res = await fetch(url, { ...init, headers });
    } catch (err) {
      // Dropped connection, DNS hiccup, reset by a proxy: try again a few times.
      if (attempt >= MAX_ATTEMPTS - 1) throw new Error(`OneDrive not reachable: ${(err as Error).message}`);
      await sleep(backoff(attempt));
      return this.graph(url, init, attempt + 1);
    }
    if ([429, 500, 502, 503, 504].includes(res.status) && attempt < MAX_ATTEMPTS - 1) {
      const after = Number(res.headers.get("retry-after"));
      const wait = after > 0 ? Math.min(120, after) * 1000 : backoff(attempt);
      await res.body?.cancel();
      await sleep(wait);
      return this.graph(url, init, attempt + 1);
    }
    if (res.status === 401 && attempt === 0 && init.auth !== false) {
      tokenCache.delete(this.cacheKey());
      await res.body?.cancel();
      return this.graph(url, init, attempt + 1);
    }
    return res;
  }

  private async fail(res: Response, what: string): Promise<never> {
    const j = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
    const hint = res.status === 507 || j.error?.code === "quotaLimitReached" ? "OneDrive is full" : j.error?.message ?? res.statusText;
    throw new Error(`OneDrive ${what} failed: ${hint} (HTTP ${res.status})`);
  }

  /** Creates every segment of the backup folder that does not exist yet. */
  private async ensureFolder() {
    const parts = this.cfg.folder.split(/[\\/]+/).filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
      const here = parts.slice(0, i + 1).join("/");
      const probe = await this.graph(`${itemUrl(here)}?$select=id,folder`);
      if (probe.ok) {
        await probe.body?.cancel();
        continue;
      }
      if (probe.status !== 404) await this.fail(probe, "folder check");
      const parent = parts.slice(0, i).join("/");
      const res = await this.graph(`${itemUrl(parent)}/children`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: parts[i], folder: {}, "@microsoft.graph.conflictBehavior": "fail" }),
      });
      if (!res.ok && res.status !== 409) await this.fail(res, "create folder");
      await res.body?.cancel();
    }
  }

  async test() {
    const me = await this.graph(`${graphBase()}/me/drive?$select=driveType,owner,quota`);
    if (!me.ok) await this.fail(me, "drive check");
    const drive = (await me.json()) as { driveType?: string; owner?: { user?: { displayName?: string } }; quota?: { remaining?: number } };
    await this.ensureFolder();
    const probe = `.portal-write-test-${Date.now()}`;
    const put = await this.graph(`${itemUrl(this.cfg.folder, probe)}/content`, { method: "PUT", body: "ok" });
    if (!put.ok) await this.fail(put, "write test");
    await put.body?.cancel();
    await this.remove(probe);
    const free = drive.quota?.remaining != null ? `, ${(drive.quota.remaining / 1024 ** 3).toFixed(1)} GB free` : "";
    const who = this.cfg.account || drive.owner?.user?.displayName || "";
    return { details: `OneDrive ok${who ? ` (${who})` : ""}, folder /${this.cfg.folder.replace(/^\/+/, "")}${free}` };
  }

  async upload(localPath: string, remoteName: string) {
    await this.ensureFolder();
    const size = statSync(localPath).size;
    const target = itemUrl(this.cfg.folder, remoteName);
    if (size <= SIMPLE_MAX) {
      const res = await this.graph(`${target}/content?@microsoft.graph.conflictBehavior=replace`, {
        method: "PUT",
        headers: { "content-type": "application/octet-stream" },
        body: await readRange(localPath, 0, size),
      });
      if (!res.ok) await this.fail(res, "upload");
      await res.body?.cancel();
      return;
    }
    await this.uploadSession(localPath, target, size);
  }

  /**
   * Upload session: the file only appears in OneDrive once the last chunk is in. A chunk that fails (dropped connection,
   * server error) is resumed from what Graph says it still expects (`nextExpectedRanges`), so a hiccup halfway a large
   * archive does not start over. A session that has expired or vanished is started once more from the beginning.
   */
  private async uploadSession(localPath: string, target: string, size: number, restarted = false): Promise<void> {
    const s = await this.graph(`${target}/createUploadSession`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "replace" } }),
    });
    if (!s.ok) await this.fail(s, "upload session");
    const { uploadUrl } = (await s.json()) as { uploadUrl: string };
    let offset = 0;
    let failures = 0;
    let done: { size?: number } | undefined;
    try {
      while (!done) {
        const end = Math.min(size, offset + CHUNK) - 1;
        let res: Response | undefined;
        let error: Error | undefined;
        try {
          // The upload URL is pre-authorised; Graph rejects a bearer token here.
          res = await fetch(uploadUrl, {
            method: "PUT",
            headers: { "content-length": String(end - offset + 1), "content-range": `bytes ${offset}-${end}/${size}` },
            body: await readRange(localPath, offset, end - offset + 1),
          });
        } catch (err) {
          error = err as Error;
        }
        if (res?.status === 200 || res?.status === 201) {
          done = (await res.json().catch(() => ({}))) as { size?: number };
          break;
        }
        if (res?.status === 202) {
          const j = (await res.json().catch(() => ({}))) as { nextExpectedRanges?: string[] };
          offset = nextOffset(j.nextExpectedRanges) ?? end + 1;
          failures = 0;
          continue;
        }
        if (res && res.status === 404 && !restarted) {
          await res.body?.cancel();
          return this.uploadSession(localPath, target, size, true);
        }
        if (res && ![409, 416, 429, 500, 502, 503, 504].includes(res.status)) await this.fail(res, "upload");
        await res?.body?.cancel();
        if (++failures >= MAX_ATTEMPTS) throw new Error(`OneDrive upload failed after ${MAX_ATTEMPTS} attempts: ${error?.message ?? `HTTP ${res?.status}`}`);
        const after = Number(res?.headers.get("retry-after"));
        await sleep(after > 0 ? Math.min(120, after) * 1000 : backoff(failures - 1));
        // Ask the session where to go on: Graph may have stored part of the chunk, or all of it.
        const status = await fetch(uploadUrl).catch(() => undefined);
        if (status?.ok) {
          const j = (await status.json().catch(() => ({}))) as { nextExpectedRanges?: string[] };
          const next = nextOffset(j.nextExpectedRanges);
          if (next != null) offset = next;
        } else {
          await status?.body?.cancel();
          if (status?.status === 404 && !restarted) return this.uploadSession(localPath, target, size, true);
        }
      }
    } catch (err) {
      await fetch(uploadUrl, { method: "DELETE" }).catch(() => undefined);
      throw err;
    }
    if (done.size != null && done.size !== size) throw new Error(`OneDrive upload incomplete: ${done.size} of ${size} bytes arrived`);
  }

  /** Downloads a file and checks its size against OneDrive; a broken transfer is tried again. */
  async download(remoteName: string, localPath: string) {
    const meta = await this.graph(`${itemUrl(this.cfg.folder, remoteName)}?$select=size`);
    if (!meta.ok) await this.fail(meta, "download");
    const expected = ((await meta.json()) as { size?: number }).size;
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await this.graph(`${itemUrl(this.cfg.folder, remoteName)}/content`, { redirect: "follow" });
        if (!res.ok || !res.body) await this.fail(res, "download");
        await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), createWriteStream(localPath));
        const got = statSync(localPath).size;
        if (expected != null && got !== expected) throw new Error(`OneDrive download incomplete: ${got} of ${expected} bytes`);
        return;
      } catch (err) {
        if (attempt >= MAX_ATTEMPTS - 1 || /HTTP 4\d\d/.test((err as Error).message)) throw err;
        await sleep(backoff(attempt));
      }
    }
  }

  async list(): Promise<RemoteFile[]> {
    await this.ensureFolder();
    const out: RemoteFile[] = [];
    let url: string | undefined = `${itemUrl(this.cfg.folder)}/children?$select=name,size,file&$top=500`;
    while (url) {
      const res = await this.graph(url);
      if (!res.ok) await this.fail(res, "list");
      const page = (await res.json()) as { value: { name: string; size: number; file?: unknown }[]; "@odata.nextLink"?: string };
      for (const it of page.value) if (it.file) out.push({ name: it.name, size: it.size });
      url = page["@odata.nextLink"];
    }
    return out;
  }

  async remove(remoteName: string) {
    const res = await this.graph(itemUrl(this.cfg.folder, remoteName), { method: "DELETE" });
    if (!res.ok && res.status !== 404) await this.fail(res, "delete");
    await res.body?.cancel();
  }
}

/** First byte Graph still wants, from `nextExpectedRanges` like ["26214400-"] or ["0-1023", "4096-"]. */
export function nextOffset(ranges?: string[]): number | undefined {
  const starts = (ranges ?? []).map((r) => Number(r.split("-")[0])).filter((n) => Number.isFinite(n));
  return starts.length ? Math.min(...starts) : undefined;
}

async function readRange(path: string, start: number, length: number): Promise<Uint8Array<ArrayBuffer>> {
  const fh = await open(path, "r");
  try {
    const buf = new Uint8Array(length);
    let off = 0;
    while (off < length) {
      const { bytesRead } = await fh.read(buf, off, length - off, start + off);
      if (!bytesRead) break;
      off += bytesRead;
    }
    return buf.subarray(0, off);
  } finally {
    await fh.close();
  }
}
