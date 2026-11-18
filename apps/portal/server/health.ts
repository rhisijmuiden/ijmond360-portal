/**
 * Status light: checks every button's address once a minute. Only "is something answering": a GET with a short
 * timeout, no redirects followed, nothing read beyond the status line. Internal apps often use their own
 * certificates, so the certificate is not checked here (nothing is sent but the request line).
 */
import type { Platform } from "@portal/platform";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { classify } from "./portallogic.js";

export const HEALTH_INTERVAL_MS = 60_000;
const TIMEOUT_MS = 6_000;
const PARALLEL = 6;

export function probe(url: string, timeoutMs = TIMEOUT_MS): Promise<{ status?: number; error?: string; latencyMs: number }> {
  const started = Date.now();
  return new Promise((resolve) => {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return resolve({ error: "invalid_url", latencyMs: 0 });
    }
    const req = (u.protocol === "https:" ? httpsRequest : httpRequest)(
      u,
      { method: "GET", timeout: timeoutMs, rejectUnauthorized: false, headers: { "User-Agent": "ijmond360-portal-health", Accept: "*/*" } },
      (res) => {
        resolve({ status: res.statusCode, latencyMs: Date.now() - started });
        res.destroy();
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (e) => resolve({ error: e.message.slice(0, 200), latencyMs: Date.now() - started }));
    req.end();
  });
}

export class HealthChecker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  constructor(
    private platform: Platform,
    private targets: () => { id: number; url: string }[],
    private probeFn: typeof probe = probe,
  ) {}

  start() {
    this.timer = setInterval(() => void this.runAll(), HEALTH_INTERVAL_MS);
    this.timer.unref();
    setTimeout(() => void this.runAll(), 2_000).unref();
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  async check(id: number, url: string) {
    const r = await this.probeFn(url);
    this.platform.ctx.db
      .prepare(
        `INSERT INTO portal_health (app_id, status, http_status, latency_ms, error, checked_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(app_id) DO UPDATE SET status = excluded.status, http_status = excluded.http_status, latency_ms = excluded.latency_ms,
           error = excluded.error, checked_at = excluded.checked_at`,
      )
      .run(id, classify(r), r.status ?? null, r.latencyMs, r.error ?? null, new Date().toISOString());
  }

  async runAll() {
    if (this.running) return;
    this.running = true;
    try {
      const queue = [...this.targets()];
      const worker = async () => {
        for (let t = queue.shift(); t; t = queue.shift()) {
          try {
            await this.check(t.id, t.url);
          } catch (err) {
            // The app may have been deleted meanwhile (foreign key).
            this.platform.ctx.log.debug({ err, app: t.id }, "health check not stored");
          }
        }
      };
      await Promise.all(Array.from({ length: PARALLEL }, worker));
    } finally {
      this.running = false;
    }
  }
}
