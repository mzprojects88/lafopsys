// The dev <-> production sync defers every link between tables (0104); a link that can't be deferred
// stops every run (26 Oct - 4 Nov 2026, fixed by 0125). Migrations after 0125 must declare each new
// link `deferrable initially immediate`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

test("links added after 0125 can be deferred", () => {
  const dir = new URL("../supabase/migrations/", import.meta.url);
  const offenders = [];
  for (const file of readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f) && Number(f.slice(0, 4)) > 125)) {
    const sql = readFileSync(new URL(file, dir), "utf8").replace(/--[^\n]*/g, "");
    for (const statement of sql.split(";")) {
      if (/\breferences\s+[a-z_]+\.[a-z_]+/i.test(statement) && !/\bdeferrable\b/i.test(statement)) offenders.push(`${file}: ${statement.trim().slice(0, 80)}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("the bell calls the sync failing when the last run failed or nothing worked for three hours", async () => {
  const { syncFailing } = await import("../lib/utils/db-sync.ts");
  const now = Date.parse("2026-11-04T12:00:00Z");
  assert.equal(syncFailing("success", "2026-11-04T11:20:00Z", now), false);
  assert.equal(syncFailing("failed", "2026-11-04T11:20:00Z", now), true);
  assert.equal(syncFailing("success", "2026-11-04T08:00:00Z", now), true);
  assert.equal(syncFailing("success", null, now), true);
});
