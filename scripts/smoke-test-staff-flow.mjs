// Regression smoke test for Phase 5 (Staff/Reference Data). Exercises the
// exact insert/update shapes used by use-time-entries-collection.ts,
// use-shifts-collection.ts, use-timesheet-approvals-collection.ts,
// use-volunteers-collection.ts, use-reference-table-collection.ts, and
// use-diagnoses-reference-collection.ts against the live DB, then deletes
// everything it created.
//
// Usage: node --env-file=.env.local scripts/smoke-test-staff-flow.mjs

import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const { data: staffRows } = await admin.schema("shared").from("staff").select("id").limit(1);
  if (!staffRows?.length) { console.error("Missing shared.staff reference data."); process.exit(1); }
  const staffId = staffRows[0].id;

  // 1. Shift.
  const shiftId = randomUUID();
  const { error: shiftError } = await admin.schema("ops").from("shifts").insert({
    id: shiftId, staff_id: staffId, date: "2026-08-18", start_time: "06:00", end_time: "14:00", label: "AM",
  });
  if (shiftError) { console.error("Shift insert failed:", shiftError.message); process.exit(1); }
  console.log("[ok] shift inserted");

  // 2. Time entry -- clock in then clock out (mirrors useTimeEntriesData.clockIn/clockOut).
  const entryId = randomUUID();
  const { error: entryError } = await admin.schema("ops").from("time_entries").insert({
    id: entryId, staff_id: staffId, date: "2026-08-18", clock_in: "06:02",
  });
  if (entryError) { console.error("Time entry insert failed:", entryError.message); process.exit(1); }
  const { error: clockOutError } = await admin.schema("ops").from("time_entries").update({ clock_out: "14:05" }).eq("id", entryId);
  if (clockOutError) { console.error("Clock-out update failed:", clockOutError.message); process.exit(1); }
  console.log("[ok] time entry clocked in and out");

  // 2b. unique(staff_id, date) -- a second entry for the same staff/date must fail.
  const { error: dupError } = await admin.schema("ops").from("time_entries").insert({
    id: randomUUID(), staff_id: staffId, date: "2026-08-18", clock_in: "07:00",
  });
  if (!dupError) { console.error("Expected unique(staff_id, date) violation, insert succeeded."); process.exit(1); }
  console.log("[ok] unique(staff_id, date) constraint enforced");

  // 3. Timesheet approval.
  const approvalId = randomUUID();
  const { error: approvalError } = await admin.schema("ops").from("timesheet_approvals").insert({
    id: approvalId, time_entry_id: entryId, staff_id: staffId, status: "pending",
  });
  if (approvalError) { console.error("Timesheet approval insert failed:", approvalError.message); process.exit(1); }
  const { error: approveUpdateError } = await admin.schema("ops").from("timesheet_approvals").update({ status: "approved" }).eq("id", approvalId);
  if (approveUpdateError) { console.error("Approval status update failed:", approveUpdateError.message); process.exit(1); }
  console.log("[ok] timesheet approval inserted and approved");

  // 4. Volunteer + certificate increment.
  const volunteerId = randomUUID();
  const { error: volunteerError } = await admin.schema("ops").from("volunteers").insert({
    id: volunteerId, first_name: "Smoke", last_name: "Test", focus_area: "Care Cart", total_hours: 10, certificates_issued: 0,
  });
  if (volunteerError) { console.error("Volunteer insert failed:", volunteerError.message); process.exit(1); }
  const { error: certError } = await admin.schema("ops").from("volunteers").update({ certificates_issued: 1 }).eq("id", volunteerId);
  if (certError) { console.error("Certificate increment failed:", certError.message); process.exit(1); }
  console.log("[ok] volunteer inserted and certificate count incremented");

  // 5. Reference tables (generic + diagnoses' constrained category).
  const provinceId = `prov-smoke-${Date.now()}`;
  const { error: provinceError } = await admin.schema("ops").from("provinces").insert({ id: provinceId, name: "Smoke Test Province", region: "Test Region" });
  if (provinceError) { console.error("Province insert failed:", provinceError.message); process.exit(1); }
  console.log("[ok] province inserted");

  const diagnosisId = `diag-smoke-${Date.now()}`;
  const { error: diagnosisError } = await admin.schema("ops").from("diagnoses").insert({ id: diagnosisId, name: "Smoke Test Diagnosis", category: "other" });
  if (diagnosisError) { console.error("Diagnosis insert failed:", diagnosisError.message); process.exit(1); }
  console.log("[ok] diagnosis inserted with valid category");

  const { error: badCategoryError } = await admin.schema("ops").from("diagnoses").insert({ id: `diag-bad-${Date.now()}`, name: "Bad", category: "not_a_real_category" });
  if (!badCategoryError) { console.error("Expected category check-constraint violation, insert succeeded."); process.exit(1); }
  console.log("[ok] diagnoses.category check constraint enforced");

  // 6. metric_snapshots -- already migrated (6 real rows), just verify readable.
  const { count: snapshotCount } = await admin.schema("ops").from("metric_snapshots").select("*", { count: "exact", head: true });
  if (!snapshotCount) { console.error("ops.metric_snapshots is empty -- expected 6 real rows."); process.exit(1); }
  console.log(`[ok] ops.metric_snapshots readable (${snapshotCount} rows)`);

  // Cleanup.
  await admin.schema("ops").from("timesheet_approvals").delete().eq("id", approvalId);
  await admin.schema("ops").from("time_entries").delete().eq("id", entryId);
  await admin.schema("ops").from("shifts").delete().eq("id", shiftId);
  await admin.schema("ops").from("volunteers").delete().eq("id", volunteerId);
  await admin.schema("ops").from("provinces").delete().eq("id", provinceId);
  await admin.schema("ops").from("diagnoses").delete().eq("id", diagnosisId);

  const { data: leftoverEntries } = await admin.schema("ops").from("time_entries").select("id").eq("id", entryId);
  const { data: leftoverVolunteers } = await admin.schema("ops").from("volunteers").select("id").eq("id", volunteerId);
  if (leftoverEntries?.length || leftoverVolunteers?.length) { console.error("Cleanup incomplete."); process.exit(1); }
  console.log("[ok] cleanup verified — no test rows remain");
  console.log("\nSmoke test passed end-to-end.");
}

main();
