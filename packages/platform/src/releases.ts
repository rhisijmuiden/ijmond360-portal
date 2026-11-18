/**
 * Where releases come from. The orchestrator reads them from GitHub (with its access token) and passes them on to
 * agents and management nodes, so only the orchestrator needs access to the (private) repository.
 */
import { compareVersions } from "./semver.js";

export interface ReleaseAsset {
  name: string;
  size: number;
}
export interface ReleaseInfo {
  tag: string;
  name: string;
  body: string;
  draft: boolean;
  prerelease: boolean;
  publishedAt: string;
  url: string;
  assets: ReleaseAsset[];
}

export interface ReleaseSource {
  /** Short name for logs and the UI ("github" or "orchestrator"). */
  kind: "github" | "orchestrator";
  list(): Promise<ReleaseInfo[]>;
  /** Download one asset of a release. Throws when it is not there. */
  download(tag: string, asset: string): Promise<Response>;
}

/** Error with an HTTP-ish code the callers translate (license_required, update_check_failed, ...). */
export class ReleaseError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}

interface GhRelease {
  tag_name: string;
  name: string | null;
  body: string | null;
  draft: boolean;
  prerelease: boolean;
  published_at: string;
  html_url: string;
  assets: { name: string; url: string; size: number }[];
}

/** Tag and asset names as they appear in releases; nothing else is passed on to GitHub or served. */
export const SAFE_NAME = /^[\w.+~-]{1,200}$/;

export function githubSource(repository: string, token: string, opts: { userAgent: string; fetchImpl?: typeof fetch }): ReleaseSource {
  const f = opts.fetchImpl ?? fetch;
  const headers = (accept: string) => ({
    Accept: accept,
    "User-Agent": opts.userAgent,
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  });
  const raw = async (): Promise<GhRelease[]> => {
    const res = await f(`https://api.github.com/repos/${repository}/releases?per_page=50`, { headers: headers("application/vnd.github+json"), signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new ReleaseError("update_check_failed", `GitHub responded ${res.status}`);
    return (await res.json()) as GhRelease[];
  };
  return {
    kind: "github",
    async list() {
      return (await raw()).map((r) => ({
        tag: r.tag_name,
        name: r.name ?? r.tag_name,
        body: r.body ?? "",
        draft: r.draft,
        prerelease: r.prerelease,
        publishedAt: r.published_at,
        url: r.html_url,
        assets: r.assets.map((a) => ({ name: a.name, size: a.size })),
      }));
    },
    async download(tag, asset) {
      const rel = (await raw()).find((r) => r.tag_name === tag);
      const a = rel?.assets.find((x) => x.name === asset);
      if (!a) throw new ReleaseError("not_found", `${tag}/${asset} not found`, 404);
      // The API URL redirects to storage; fetch drops the Authorization header on that cross-origin redirect.
      const res = await f(a.url, { headers: headers("application/octet-stream"), redirect: "follow" });
      if (!res.ok || !res.body) throw new ReleaseError("download_failed", `Download failed: ${res.status}`);
      return res;
    },
  };
}

/** Releases through the orchestrator (`<base>/releases`, `<base>/releases/<tag>/assets/<name>`). */
export function orchestratorSource(base: string, authorization: string, fetchImpl: typeof fetch = fetch): ReleaseSource {
  const url = (path: string) => `${base.replace(/\/+$/, "")}${path}`;
  const fail = async (res: Response) => {
    let code = "orchestrator_unreachable";
    try {
      code = ((await res.json()) as { error?: string }).error ?? code;
    } catch {
      /* not json */
    }
    if (res.status === 404) code = "orchestrator_outdated";
    if (res.status === 401) code = "orchestrator_token_rejected";
    throw new ReleaseError(code, `orchestrator answered ${res.status} (${code})`, res.status === 403 ? 403 : 502);
  };
  return {
    kind: "orchestrator",
    async list() {
      const res = await fetchImpl(url("/releases"), { headers: { authorization }, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) await fail(res);
      return ((await res.json()) as { releases: ReleaseInfo[] }).releases;
    },
    async download(tag, asset) {
      const res = await fetchImpl(url(`/releases/${encodeURIComponent(tag)}/assets/${encodeURIComponent(asset)}`), { headers: { authorization } });
      if (!res.ok || !res.body) await fail(res);
      return res;
    },
  };
}

/** Newest usable release on a channel that has the asset `assetFor(tag)`. */
export function latestRelease(releases: ReleaseInfo[], channel: "production" | "test", assetFor: (tag: string) => string) {
  return (
    releases
      .filter((r) => !r.draft && (channel === "test" || !r.prerelease))
      .filter((r) => r.assets.some((a) => a.name === assetFor(r.tag)))
      .sort((a, b) => compareVersions(b.tag, a.tag))[0] ?? null
  );
}

/** Expected checksum of `asset` from a SHA256SUMS file. */
export function checksumFor(sums: string, asset: string) {
  for (const line of sums.split("\n")) {
    const m = /^([0-9a-f]{64})\s+\*?(.+?)\s*$/i.exec(line.trim());
    if (m && m[2] === asset) return m[1]!.toLowerCase();
  }
  return undefined;
}
