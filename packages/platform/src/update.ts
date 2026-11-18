import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync } from "node:fs";
import { arch, release as osRelease, uptime } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { PlatformContext } from "./context.js";
import { HttpError } from "./context.js";
import { checksumFor, githubSource, latestRelease, ReleaseError, type ReleaseInfo, type ReleaseSource } from "./releases.js";
import { compareVersions } from "./semver.js";

export type Channel = "production" | "test";
const MASK = "********";

const updateSettingsSchema = z.object({
  channel: z.enum(["production", "test"]).default("production"),
  repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/).default("rhisijmuiden/ijmond360-portal"),
  githubToken: z.string().default(""),
  autoCheck: z.boolean().default(true),
  /** "github" = straight from the repository; "orchestrator" = through the orchestrator (management nodes). */
  source: z.enum(["github", "orchestrator"]).default("github"),
});
export type UpdateSettings = z.infer<typeof updateSettingsSchema>;

export interface UpdateCheck {
  current: string;
  channel: Channel;
  latest: string | null;
  available: boolean;
  /** True when the latest version on the selected channel is older (e.g. after switching test -> production). */
  isDowngrade: boolean;
  releaseName?: string;
  releaseNotes?: string;
  releaseUrl?: string;
  publishedAt?: string;
  canApply: boolean;
  reason?: string;
  /** Where the release list came from. */
  source: "github" | "orchestrator";
  checkedAt: string;
}

/** Another place to get releases from (management: the orchestrator link), and a check that may hold updates back. */
export interface UpdateHooks {
  /** Releases through the orchestrator, or null when that link is not set up. */
  orchestrator?: () => ReleaseSource | null;
  /** A reason code when updates are not allowed now (orchestrator: no valid licence). */
  gate?: () => string | null;
}

export const assetName = (appId: string, version: string, arch: string) =>
  `ijmond360-${appId}_${version.replace(/^v/, "").replace(/[-~]/g, ".")}_${arch}.deb`;

const debArch = () => ({ x64: "amd64", arm64: "arm64" })[arch()] ?? arch();

export class UpdateService {
  private lastCheck: UpdateCheck | null = null;
  private applying = false;
  private hooks: UpdateHooks = {};
  constructor(private ctx: PlatformContext) {}

  setHooks(h: UpdateHooks) {
    this.hooks = { ...this.hooks, ...h };
    this.lastCheck = null;
  }
  /** True when the app offers the orchestrator as a release source (shown in the UI). */
  get canUseOrchestrator() {
    return !!this.hooks.orchestrator;
  }

  /** Releases straight from GitHub with this node's settings (the orchestrator passes these on). */
  github(): ReleaseSource {
    const { repository, githubToken } = this.getSettings();
    return githubSource(repository, githubToken, { userAgent: `ijmond360-${this.ctx.config.app.id}` });
  }
  source(): ReleaseSource {
    if (this.getSettings().source === "orchestrator" && this.hooks.orchestrator) {
      const s = this.hooks.orchestrator();
      if (!s) throw new HttpError(409, "orchestrator_not_linked");
      return s;
    }
    return this.github();
  }

  getSettings(): UpdateSettings {
    const s = updateSettingsSchema.parse(this.ctx.settings.get("update", {}));
    return { ...s, githubToken: this.ctx.secrets.decrypt(s.githubToken) };
  }
  saveSettings(input: unknown) {
    const next = updateSettingsSchema.parse(input);
    const cur = this.getSettings();
    const token = next.githubToken === MASK ? cur.githubToken : next.githubToken;
    this.ctx.settings.set("update", { ...next, githubToken: token ? this.ctx.secrets.encrypt(token) : "" });
    this.lastCheck = null;
  }
  publicSettings() {
    const s = this.getSettings();
    return { ...s, githubToken: s.githubToken ? MASK : "", canUseOrchestrator: this.canUseOrchestrator };
  }

  /**
   * Release asset name for a version. The Debian version uses "~" (0.2.0~test.5), but GitHub rewrites "~" in
   * asset names to ".", so packages are published as ijmond360-<app>_0.2.0.test.5_<arch>.deb.
   */
  assetPattern(version: string) {
    return assetName(this.ctx.config.app.id, version, debArch());
  }

  private async findLatest(channel: Channel): Promise<{ source: ReleaseSource; release: ReleaseInfo | null }> {
    const source = this.source();
    let releases: ReleaseInfo[];
    try {
      releases = await source.list();
    } catch (e) {
      if (e instanceof ReleaseError) throw new HttpError(e.status, e.code, e.message);
      throw e;
    }
    // Only releases that contain a package for this app and architecture.
    return { source, release: latestRelease(releases, channel, (tag) => this.assetPattern(tag)) };
  }

  async check(): Promise<UpdateCheck> {
    const { channel } = this.getSettings();
    const current = this.ctx.config.version;
    const gate = this.hooks.gate?.() ?? null;
    const { source, release: latest } = await this.findLatest(channel);
    const latestVersion = latest?.tag.replace(/^v/, "") ?? null;
    const cmp = latestVersion ? compareVersions(latestVersion, current) : 0;
    const onTestBuild = /-test\./.test(current);
    // Switching from test to production may require installing an older production build.
    const isDowngrade = !!latestVersion && cmp < 0 && channel === "production" && onTestBuild;
    this.lastCheck = {
      current,
      channel,
      latest: latestVersion,
      available: !!latestVersion && (cmp > 0 || isDowngrade),
      isDowngrade,
      releaseName: latest?.name,
      releaseNotes: latest?.body,
      releaseUrl: source.kind === "github" ? latest?.url : undefined,
      publishedAt: latest?.publishedAt,
      canApply: this.ctx.config.packaged && !gate,
      reason: !this.ctx.config.packaged ? "development_build" : (gate ?? undefined),
      source: source.kind,
      checkedAt: new Date().toISOString(),
    };
    return this.lastCheck;
  }

  status() {
    return { applying: this.applying, lastCheck: this.lastCheck, state: this.ctx.settings.get("update.state", null) };
  }

  async apply() {
    if (!this.ctx.config.packaged) throw new HttpError(400, "development_build", "Updates can only be applied to an installed package");
    if (this.applying) throw new HttpError(409, "update_in_progress");
    const gate = this.hooks.gate?.();
    if (gate) throw new HttpError(403, gate);
    const check = await this.check();
    if (!check.available || !check.latest) throw new HttpError(400, "no_update_available");
    const { source, release } = await this.findLatest(check.channel);
    if (!release) throw new HttpError(400, "no_update_available");
    const assetName = this.assetPattern(release.tag);
    this.applying = true;
    try {
      const dir = join(this.ctx.config.dataDir, "updates");
      mkdirSync(dir, { recursive: true });
      const file = join(dir, assetName);
      const res = await source.download(release.tag, assetName);
      await pipeline(Readable.fromWeb(res.body as never), createWriteStream(file));

      // Verify against SHA256SUMS published with the release.
      if (!release.assets.some((a) => a.name === "SHA256SUMS")) throw new Error("Release has no SHA256SUMS; refusing to install");
      const expected = checksumFor(await (await source.download(release.tag, "SHA256SUMS")).text(), assetName);
      const actual = createHash("sha256").update(readFileSync(file)).digest("hex");
      if (!expected || expected !== actual) throw new Error("Checksum mismatch; update aborted");

      this.ctx.settings.set("update.state", { status: "installing", from: check.current, to: check.latest, at: new Date().toISOString() });
      // The helper (installed by the package, allowed via sudoers) runs apt in a transient systemd unit,
      // so it survives the restart of this service.
      const helper = `/usr/lib/ijmond360-${this.ctx.config.app.id}/apply-update`;
      if (!existsSync(helper)) throw new Error(`Update helper missing: ${helper}`);
      const child = spawn("sudo", ["-n", helper, file], { detached: true, stdio: "ignore" });
      child.unref();
      return { started: true, from: check.current, to: check.latest };
    } catch (err) {
      this.applying = false;
      this.ctx.settings.set("update.state", { status: "failed", error: (err as Error).message, at: new Date().toISOString() });
      throw err;
    }
  }

  systemInfo() {
    let os = "";
    try {
      os = /PRETTY_NAME="([^"]+)"/.exec(readFileSync("/etc/os-release", "utf8"))?.[1] ?? "";
    } catch {
      /* not linux */
    }
    return {
      app: this.ctx.config.app,
      version: this.ctx.config.version,
      channel: this.getSettings().channel,
      packaged: this.ctx.config.packaged,
      hostname: this.ctx.config.hostname,
      os: os || `${process.platform} ${osRelease()}`,
      node: process.version,
      arch: arch(),
      uptimeSeconds: Math.round(process.uptime()),
      systemUptimeSeconds: Math.round(uptime()),
      license: "proprietary",
    };
  }

}

export function registerUpdate(app: FastifyInstance, ctx: PlatformContext, updates: UpdateService) {
  app.get("/api/system/health", async () => ({ ok: true, version: ctx.config.version }));
  app.get("/api/system/info", async () => updates.systemInfo());
  app.get("/api/system/update", async () => ({ settings: updates.publicSettings(), ...updates.status() }));
  app.put("/api/system/update/settings", async (req) => {
    updates.saveSettings(req.body);
    return updates.publicSettings();
  });
  app.post("/api/system/update/check", async () => updates.check());
  app.post("/api/system/update/apply", async () => updates.apply());

  // Mark a finished update on startup and periodically check in the background.
  const state = ctx.settings.get<{ status: string; to?: string } | null>("update.state", null);
  if (state?.status === "installing") {
    ctx.settings.set("update.state", {
      status: state.to === ctx.config.version ? "installed" : "failed",
      to: state.to,
      error: state.to === ctx.config.version ? undefined : "Version after restart does not match",
      at: new Date().toISOString(),
    });
  }
  const timer = setInterval(() => {
    if (updates.getSettings().autoCheck) updates.check().catch(() => undefined);
  }, 6 * 60 * 60 * 1000);
  timer.unref();
}
