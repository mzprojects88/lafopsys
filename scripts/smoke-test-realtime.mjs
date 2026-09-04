// Smoke test for the live-update layer (migration 0027 + lib/data/realtime-provider.tsx).
//
// Proves, against the real project, that Supabase Realtime delivers
// postgres_changes events for the tables the app subscribes to:
//   1. publication coverage -- every ops.* / shared.* table is in the
//      supabase_realtime publication (needs the `pg` driver; skipped with a
//      note when it is not installed, since the round trips below still prove
//      the migration ran on both schemas);
//   2. per-table round trip on ops.time_entries (INSERT then DELETE);
//   3. schema-wide round trip -- a listener with no `table` sees the same
//      change and reports the right table name (this is what the provider uses);
//   4. shared.app_settings UPDATE + revert proves the second schema.
//
// Writes only a throwaway time_entries row dated 2000-01-01 for the first staff
// member and briefly flips one app_settings column back to its own value; both
// are cleaned up on every exit path. Non-zero exit on any failure.
//
// Usage: node --env-file=.env.local scripts/smoke-test-realtime.mjs

import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local.");
  process.exit(1);
}

const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

const EVENT_TIMEOUT_MS = 5000;
/** Realtime acks a join slightly before its poller picks up the new
 * subscription, so a write in the first few hundred ms can be missed. */
const SETTLE_MS = 3000;
const SMOKE_DATE = "2000-01-01";
let failed = false;
let cleanup = async () => {};

function fail(message, detail) {
  failed = true;
  console.error(`FAIL: ${message}`, detail ?? "");
}

/** Subscribes to a postgres_changes filter and resolves once the channel is live. */
function listen(filter, onEvent) {
  return new Promise((resolve, reject) => {
    const channel = admin.channel(`smoke-realtime:${randomUUID()}`).on("postgres_changes", filter, onEvent);
    const timer = setTimeout(() => reject(new Error(`subscribe timed out for ${JSON.stringify(filter)}`)), EVENT_TIMEOUT_MS);
    channel.subscribe((status, err) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(timer);
        resolve(channel);
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        clearTimeout(timer);
        reject(err ?? new Error(`channel ${status}`));
      }
    });
  });
}

/** Returns a promise for the next event matching `predicate`, failing after the timeout. */
function expectEvent(label, register, predicate) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}: no matching event within ${EVENT_TIMEOUT_MS} ms`)), EVENT_TIMEOUT_MS);
    register((payload) => {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

async function checkPublicationCoverage() {
  let pg;
  try {
    pg = await import("pg");
  } catch {
    console.log("[skip] publication coverage: 'pg' driver not installed (npm i -D pg to enable this check)");
    return;
  }
  const password = process.env.SUPABASE_DB_PASSWORD;
  if (!password) {
    console.log("[skip] publication coverage: SUPABASE_DB_PASSWORD not set");
    return;
  }
  const projectRef = new URL(url).hostname.split(".")[0];
  const client = new pg.Client({
    connectionString: `postgresql://postgres.${projectRef}:${encodeURIComponent(password)}@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres`,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const { rows } = await client.query(`
      select t.schemaname, t.tablename
      from pg_tables t
      where t.schemaname in ('ops', 'shared')
        and not exists (
          select 1 from pg_publication_tables p
          where p.pubname = 'supabase_realtime' and p.schemaname = t.schemaname and p.tablename = t.tablename)
      order by 1, 2`);
    if (rows.length > 0) {
      fail(`${rows.length} table(s) missing from supabase_realtime`, rows.map((r) => `${r.schemaname}.${r.tablename}`).join(", "));
    } else {
      console.log("[ok] every ops.* / shared.* table is in the supabase_realtime publication");
    }
  } finally {
    await client.end();
  }
}

async function main() {
  await checkPublicationCoverage();

  const { data: staffRows, error: staffError } = await admin.schema("shared").from("staff").select("id").limit(1);
  if (staffError || !staffRows?.length) {
    fail("Could not read a shared.staff row", staffError?.message ?? "no rows");
    return;
  }
  const staffId = staffRows[0].id;

  // Leftover from an interrupted earlier run would violate unique(staff_id, date).
  await admin.schema("ops").from("time_entries").delete().eq("staff_id", staffId).eq("date", SMOKE_DATE);

  const entryId = randomUUID();
  cleanup = async () => {
    await admin.schema("ops").from("time_entries").delete().eq("id", entryId);
  };

  // ---- 2 + 3: table-scoped and schema-wide listeners on the same insert ----
  let tableHandler = () => {};
  let schemaHandler = () => {};
  const tableChannel = await listen({ event: "*", schema: "ops", table: "time_entries" }, (p) => tableHandler(p));
  const schemaChannel = await listen({ event: "*", schema: "ops" }, (p) => schemaHandler(p));
  console.log("[ok] subscribed: ops.time_entries (table) and ops (schema-wide)");
  await new Promise((r) => setTimeout(r, SETTLE_MS));

  const insertSeen = expectEvent(
    "ops.time_entries INSERT",
    (h) => (tableHandler = h),
    (p) => p.eventType === "INSERT" && p.new?.id === entryId
  );
  const schemaInsertSeen = expectEvent(
    "schema-wide INSERT",
    (h) => (schemaHandler = h),
    (p) => p.eventType === "INSERT" && p.table === "time_entries" && p.new?.id === entryId
  );

  const { error: insertError } = await admin
    .schema("ops")
    .from("time_entries")
    .insert({ id: entryId, staff_id: staffId, date: SMOKE_DATE, clock_in: "08:00" });
  if (insertError) {
    fail("time_entries insert failed", insertError.message);
  } else {
    try {
      await Promise.all([insertSeen, schemaInsertSeen]);
      console.log("[ok] INSERT delivered to both the table listener and the schema-wide listener");
    } catch (e) {
      fail(e.message);
    }
  }

  const deleteSeen = expectEvent(
    "ops.time_entries DELETE",
    (h) => (tableHandler = h),
    (p) => p.eventType === "DELETE" && p.old?.id === entryId
  );
  await cleanup();
  cleanup = async () => {};
  try {
    await deleteSeen;
    console.log("[ok] DELETE delivered (primary key only, as expected with default replica identity)");
  } catch (e) {
    fail(e.message);
  }
  await admin.removeChannel(tableChannel);
  await admin.removeChannel(schemaChannel);

  // ---- 4: second schema ----
  const { data: settings, error: settingsError } = await admin
    .schema("shared")
    .from("app_settings")
    .select("id, require_clock_in_for_inventory_roles")
    .limit(1)
    .maybeSingle();
  if (settingsError || !settings) {
    fail("Could not read shared.app_settings", settingsError?.message ?? "no row");
    return;
  }
  let sharedHandler = () => {};
  const sharedChannel = await listen({ event: "*", schema: "shared" }, (p) => sharedHandler(p));
  await new Promise((r) => setTimeout(r, SETTLE_MS));
  const updateSeen = expectEvent(
    "shared.app_settings UPDATE",
    (h) => (sharedHandler = h),
    (p) => p.eventType === "UPDATE" && p.table === "app_settings"
  );
  // Writing the current value back is still an UPDATE for logical replication.
  const { error: updateError } = await admin
    .schema("shared")
    .from("app_settings")
    .update({ require_clock_in_for_inventory_roles: settings.require_clock_in_for_inventory_roles })
    .eq("id", settings.id);
  if (updateError) {
    fail("app_settings update failed", updateError.message);
  } else {
    try {
      await updateSeen;
      console.log("[ok] shared-schema listener received the app_settings UPDATE");
    } catch (e) {
      fail(e.message);
    }
  }
  await admin.removeChannel(sharedChannel);
}

main()
  .catch((e) => fail("unexpected error", e?.message ?? e))
  .finally(async () => {
    await cleanup().catch(() => {});
    await admin.removeAllChannels();
    if (failed) {
      console.error("Realtime smoke test FAILED");
      process.exit(1);
    }
    console.log("Realtime smoke test passed");
    process.exit(0);
  });
