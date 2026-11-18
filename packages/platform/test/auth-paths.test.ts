/**
 * Percent-encoded paths (`/%61pi/users`) reach the same routes as `/api/users`: the session and admin checks must
 * look at the routed path, not at the raw URL, or they can be skipped.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createPlatform, type Platform } from "../src/index.ts";

const root = mkdtempSync(join(tmpdir(), "tvsm-authpath-"));
process.env.PORTAL_DATA_DIR = join(root, "data");
process.env.PORTAL_CONF_DIR = join(root, "conf");
process.env.PORTAL_DEFAULT_ADMIN = "off";

let p: Platform;
const call = async (method: string, url: string, payload?: unknown, cookie = "") => {
  const res = await p.server.inject({ method: method as "GET", url, payload: payload as object, headers: cookie ? { cookie } : {} });
  const set = res.headers["set-cookie"];
  return { status: res.statusCode, cookie: set ? String(Array.isArray(set) ? set[0] : set).split(";")[0]! : "" };
};

test.before(async () => {
  p = await createPlatform({ app: { id: "authpath", name: "Auth path", defaultPort: 0 } });
});
test.after(async () => {
  await p.server.close();
  rmSync(root, { recursive: true, force: true });
});

const ENCODED = ["/%61pi/users", "/api/%75sers", "/%2561pi/users", "/a%70i/system/info"];

test("encoded /api paths still need a session", async () => {
  const admin = await call("POST", "/api/auth/setup", { username: "admin", password: "correct horse battery" });
  assert.equal(admin.status, 200);
  for (const url of ENCODED) {
    const r = await call("GET", url);
    assert.ok(r.status === 401 || r.status === 404, `${url} answered ${r.status}`);
  }
  const created = await call("POST", "/%61pi/users", { username: "intruder", password: "0123456789ab", role: "admin" });
  assert.equal(created.status, 401);
});

test("encoded /api paths still need the admin role", async () => {
  const admin = (await call("POST", "/api/auth/login", { username: "admin", password: "correct horse battery" })).cookie;
  assert.equal((await call("POST", "/api/users", { username: "op1", password: "0123456789ab", role: "operator" }, admin)).status, 200);
  const op = (await call("POST", "/api/auth/login", { username: "op1", password: "0123456789ab" })).cookie;
  assert.ok(op);
  assert.equal((await call("GET", "/api/users", undefined, op)).status, 403);
  assert.equal((await call("GET", "/api/%75sers", undefined, op)).status, 403);
  assert.equal((await call("POST", "/api/%75sers", { username: "op2", password: "0123456789ab", role: "admin" }, op)).status, 403);
  assert.equal((await call("PUT", "/api/system/update/%73ettings", { channel: "test" }, op)).status, 403);
});

test("failed sign-ins are throttled per address and user name", async () => {
  const { LoginThrottle } = await import("../src/auth.ts");
  let now = 0;
  const t = new LoginThrottle(() => now);
  for (let i = 0; i < 9; i++) t.failed("10.0.0.1", "Admin");
  assert.equal(t.blocked("10.0.0.1", "admin"), false);
  t.failed("10.0.0.1", "admin");
  assert.equal(t.blocked("10.0.0.1", "ADMIN"), true);
  assert.equal(t.blocked("10.0.0.2", "admin"), false, "another address is not held back by these 10");
  now += 15 * 60_000;
  assert.equal(t.blocked("10.0.0.1", "admin"), false, "the window passes");
  for (let i = 0; i < 50; i++) t.failed(`10.1.0.${i}`, "editor");
  assert.equal(t.blocked("10.9.9.9", "editor"), true, "50 failures from anywhere hold the user name back");
  t.failed("10.0.0.1", "op");
  t.succeeded("10.0.0.1", "op");
  assert.equal(t.blocked("10.0.0.1", "op"), false);
});

test("the login answers 429 after 10 wrong passwords", async () => {
  for (let i = 0; i < 10; i++) assert.equal((await call("POST", "/api/auth/login", { username: "admin", password: "wrong password!" })).status, 401);
  assert.equal((await call("POST", "/api/auth/login", { username: "admin", password: "correct horse battery" })).status, 429);
});
