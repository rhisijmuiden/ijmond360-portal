import assert from "node:assert/strict";
import { test } from "node:test";
import { checksumFor, latestRelease, orchestratorSource, ReleaseError, type ReleaseInfo } from "../src/releases.ts";

const rel = (tag: string, prerelease: boolean, assets: string[]): ReleaseInfo => ({
  tag,
  name: tag,
  body: "",
  draft: false,
  prerelease,
  publishedAt: "2026-11-11T00:00:00Z",
  url: "",
  assets: assets.map((name) => ({ name, size: 1 })),
});

test("latestRelease picks the newest release with the asset on the channel", () => {
  const list = [rel("v1.0.0", false, ["a_1.0.0.deb"]), rel("v1.1.0-test.2", true, ["a_1.1.0.test.2.deb"]), rel("v1.0.1", false, ["other.deb"])];
  const asset = (tag: string) => `a_${tag.replace(/^v/, "").replace(/-/g, ".")}.deb`;
  assert.equal(latestRelease(list, "production", asset)?.tag, "v1.0.0");
  assert.equal(latestRelease(list, "test", asset)?.tag, "v1.1.0-test.2");
  assert.equal(latestRelease([], "test", asset), null);
});

test("checksumFor matches the exact file name", () => {
  const h1 = "a".repeat(64);
  const h2 = "b".repeat(64);
  const sums = `${h1}  x-ijmond360-agent_1.0_amd64.deb\n${h2}  ijmond360-agent_1.0_amd64.deb\n`;
  assert.equal(checksumFor(sums, "ijmond360-agent_1.0_amd64.deb"), h2);
  assert.equal(checksumFor(`${h2} *portal.zip`, "portal.zip"), h2);
  assert.equal(checksumFor(sums, "missing.deb"), undefined);
});

test("orchestratorSource lists, downloads and maps errors", async () => {
  const seen: { url: string; auth: string | null }[] = [];
  const fake = (async (url: string, init?: RequestInit) => {
    seen.push({ url, auth: new Headers(init?.headers).get("authorization") });
    if (url.endsWith("/v1/releases")) return Response.json({ releases: [rel("v1.0.0", false, ["SHA256SUMS"])] });
    if (url.includes("/assets/")) return new Response("sums");
    return new Response("", { status: 404 });
  }) as typeof fetch;
  const src = orchestratorSource("http://orch:8080/automation-api/v1/", "Bearer t", fake);
  assert.equal((await src.list())[0]!.tag, "v1.0.0");
  assert.equal(await (await src.download("v1.0.0", "SHA256SUMS")).text(), "sums");
  assert.deepEqual(seen.map((s) => s.url), ["http://orch:8080/automation-api/v1/releases", "http://orch:8080/automation-api/v1/releases/v1.0.0/assets/SHA256SUMS"]);
  assert.ok(seen.every((s) => s.auth === "Bearer t"));

  const answer = (status: number, body: unknown) => orchestratorSource("http://o/v1", "Bearer t", (async () => Response.json(body, { status })) as typeof fetch);
  await assert.rejects(answer(403, { error: "license_required" }).list(), (e: unknown) => e instanceof ReleaseError && e.code === "license_required" && e.status === 403);
  await assert.rejects(answer(404, {}).list(), (e: unknown) => e instanceof ReleaseError && e.code === "orchestrator_outdated");
  await assert.rejects(answer(401, {}).list(), (e: unknown) => e instanceof ReleaseError && e.code === "orchestrator_token_rejected");
});
