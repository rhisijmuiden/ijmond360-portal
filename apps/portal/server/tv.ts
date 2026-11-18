/** "Now on TV": the current and next programme from the TV Station Manager XMLTV feed, fetched every 5 minutes. */
import type { FastifyInstance } from "fastify";
import { HttpError } from "@portal/platform";
import { nowNext, parseXmltv, type PortalSettings } from "./portallogic.js";

const REFRESH_MS = 5 * 60_000;

export class TvGuide {
  private guide: { url: string; at: number; data: ReturnType<typeof parseXmltv> } | null = null;
  private loading: Promise<void> | null = null;
  constructor(private settings: () => PortalSettings["tv"]) {}

  reset() {
    this.guide = null;
  }

  private async load(url: string) {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { Accept: "application/xml, text/xml" } });
    if (!res.ok) throw new Error(`guide answered ${res.status}`);
    const text = await res.text();
    if (text.length > 20_000_000) throw new Error("guide too large");
    this.guide = { url, at: Date.now(), data: parseXmltv(text) };
  }

  async current(now = Date.now()) {
    const s = this.settings();
    if (!s.enabled || !s.xmltvUrl) throw new HttpError(404, "disabled");
    if (!this.guide || this.guide.url !== s.xmltvUrl || now - this.guide.at > REFRESH_MS) {
      this.loading ??= this.load(s.xmltvUrl).finally(() => (this.loading = null));
      try {
        await this.loading;
      } catch {
        // Keep showing the last guide when the feed is briefly away.
        if (!this.guide || this.guide.url !== s.xmltvUrl) throw new HttpError(502, "guide_unreachable");
      }
    }
    return nowNext(this.guide!.data, s.channel, now);
  }
}

export function registerTv(app: FastifyInstance, guide: TvGuide) {
  app.get("/api/portal/tv", async () => guide.current());
}
