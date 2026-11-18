import assert from "node:assert/strict";
import { test } from "node:test";
import { safeArchiveName, safeRelPath } from "../src/backup/engine.ts";

test("restore only trusts archive names and paths that stay inside the restore folder", () => {
  assert.ok(safeArchiveName("management_tv-manager_20261112T230000Z_full_1a2b3c4d.tar.gz"));
  for (const bad of ["../x.tar.gz", "a/b.tar.gz", ".hidden.tar.gz", "x.tar.gz.json", "", 5]) assert.equal(safeArchiveName(bad), false, String(bad));
  for (const ok of ["db/app.db", "conf/secret.key", "files/media/Sport/clip 1.mp4", "files/x/a..b"]) assert.ok(safeRelPath(ok), ok);
  for (const bad of ["../etc/passwd", "files/../../etc/passwd", "/etc/passwd", "a\0b", "", null]) assert.equal(safeRelPath(bad), false, String(bad));
});
