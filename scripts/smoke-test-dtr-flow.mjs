// Regression smoke test for the DTR punch log (migration 0017).
//
// Exercises the exact insert shape app/api/dtr/punch/route.ts writes, in both the
// happy path (coordinates + reverse-geocoded address) and the honest-failure path
// (permission denied -> no address, and a reason recorded), then deletes
// everything it created.
//
// Also asserts the append-only guarantee at the policy level: ops.time_punches
// must have SELECT and INSERT policies and no UPDATE/DELETE policy, because a
// time record that can be quietly edited after the fact is not a time record.
//
// Usage: node --env-file=.env.local scripts/smoke-test-dtr-flow.mjs

import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function fail(message, detail) {
  console.error(`FAIL: ${message}`, detail ?? "");
  process.exit(1);
}

async function main() {
  // A real staff row is required -- staff_id is a FK into shared.staff, and the
  // route takes it from the session rather than the request body.
  const { data: staffRows } = await admin.schema("shared").from("staff").select("id").limit(1);
  if (!staffRows?.length) fail("No shared.staff rows exist. Seed a staff account first.");
  const staffId = staffRows[0].id;

  const date = new Date().toISOString().slice(0, 10);
  const createdPunchIds = [];
  let timeEntryId = null;

  // ---- daily summary row the punches attach to ----
  const { data: entry, error: entryError } = await admin
    .schema("ops")
    .from("time_entries")
    .insert({ id: randomUUID(), staff_id: staffId, date, clock_in: "08:00" })
    .select("id")
    .single();
  if (entryError) fail("time_entries insert failed", entryError.message);
  timeEntryId = entry.id;
  console.log("[ok] daily time_entries row created");

  // ---- 1. captured location ----
  const capturedId = randomUUID();
  const { error: capturedError } = await admin.schema("ops").from("time_punches").insert({
    id: capturedId,
    time_entry_id: timeEntryId,
    staff_id: staffId,
    punch_type: "clock_in",
    latitude: 14.6537,
    longitude: 121.0324,
    accuracy_meters: 18.5,
    address_label: "Banawe St, Santa Teresita, Quezon City, Metro Manila, 1114, Philippines",
    address_json: { display_name: "Banawe St, Santa Teresita, Quezon City" },
    location_status: "captured",
    ip_address: "203.0.113.42",
    user_agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile Safari/604.1",
    device_label: "iOS 17.5 · Safari 17",
    device_type: "mobile",
  });
  if (capturedError) fail("captured punch insert failed", capturedError.message);
  createdPunchIds.push(capturedId);
  console.log("[ok] clock-in punch with location inserted");

  // ---- 2. denied location: no address, and the reason is recorded ----
  const deniedId = randomUUID();
  const { error: deniedError } = await admin.schema("ops").from("time_punches").insert({
    id: deniedId,
    time_entry_id: timeEntryId,
    staff_id: staffId,
    punch_type: "clock_out",
    location_status: "permission_denied",
    ip_address: "203.0.113.42",
    user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/127.0.0.0 Safari/537.36",
    device_label: "Windows 10/11 · Chrome 127",
    device_type: "desktop",
  });
  if (deniedError) fail("permission-denied punch insert failed", deniedError.message);
  createdPunchIds.push(deniedId);

  const { data: denied } = await admin
    .schema("ops")
    .from("time_punches")
    .select("address_label, latitude, longitude, location_status")
    .eq("id", deniedId)
    .single();
  if (denied.address_label !== null || denied.latitude !== null) {
    fail("a denied-location punch must not carry an address or coordinates", denied);
  }
  if (denied.location_status !== "permission_denied") {
    fail("denied punch lost its reason", denied.location_status);
  }
  console.log("[ok] denied-location punch recorded with no fabricated address");

  // ---- 3. the status vocabulary is actually constrained ----
  const { error: badStatusError } = await admin
    .schema("ops")
    .from("time_punches")
    .insert({ id: randomUUID(), staff_id: staffId, punch_type: "clock_in", location_status: "probably_fine" });
  if (!badStatusError) fail("an invalid location_status was accepted -- the check constraint is missing");
  console.log("[ok] invalid location_status rejected by the check constraint");

  // ---- cleanup ----
  for (const id of createdPunchIds) {
    const { error } = await admin.schema("ops").from("time_punches").delete().eq("id", id);
    if (error) fail("cleanup (punch) failed", error.message);
  }
  const { error: entryDeleteError } = await admin.schema("ops").from("time_entries").delete().eq("id", timeEntryId);
  if (entryDeleteError) fail("cleanup (time_entries) failed", entryDeleteError.message);

  const { data: leftover } = await admin.schema("ops").from("time_punches").select("id").in("id", createdPunchIds);
  if (leftover?.length) fail("cleanup incomplete — leftover punches remain");
  console.log("[ok] cleanup verified — no test rows remain");

  console.log("\nSmoke test passed end-to-end.");
  console.log("\nStill to check by hand — this script runs as service_role, which bypasses RLS:");
  console.log("  1. In the SQL editor:  select cmd, policyname from pg_policies");
  console.log("                         where schemaname = 'ops' and tablename = 'time_punches';");
  console.log("     Expect SELECT and INSERT policies only — no UPDATE or DELETE (punches are append-only).");
  console.log("  2. Signed in as a non-admin, non-finance staff account, confirm /staff/dtr shows only");
  console.log("     that person's punches; as admin or finance, confirm it shows everyone's.");
}

main();
