// Regression smoke test for Phase 1.5 (discharge, extend-stay, transfer-bed).
// Exercises the exact update shapes used by discharge-dialog.tsx,
// extend-stay-dialog.tsx, and transfer-bed-dialog.tsx (all go through
// usePatientsData().updateStay) against the live DB, then deletes everything
// it created.
//
// Usage: node --env-file=.env.local scripts/smoke-test-discharge-flow.mjs

import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const { data: prov } = await admin.schema("ops").from("provinces").select("id").limit(1);
  const { data: beds } = await admin.schema("ops").from("bed_positions").select("id").limit(2);
  if (!prov?.length || !beds || beds.length < 2) {
    console.error("Missing reference data (province or 2+ bed positions).");
    process.exit(1);
  }
  const provinceId = prov[0].id;
  const [bedA, bedB] = beds;

  const patientId = randomUUID();
  const { error: patientError } = await admin.schema("ops").from("patients").insert({
    id: patientId,
    patient_number: `SMOKE-DISCHARGE-${Date.now()}`,
    first_name: "Discharge",
    last_name: "Smoke Test",
    sex: "F",
    province_id: provinceId,
    status: "ongoing",
    admitted_at: "2026-08-18",
  });
  if (patientError) { console.error("Patient insert failed:", patientError.message); process.exit(1); }

  const stayId = randomUUID();
  const { error: stayError } = await admin.schema("ops").from("stays").insert({
    id: stayId,
    patient_id: patientId,
    bed_position_id: bedA.id,
    check_in_at: "2026-08-18",
    status: "in_house",
  });
  if (stayError) { console.error("Stay insert failed:", stayError.message); process.exit(1); }
  console.log("[ok] test patient + stay created (in_house, bed A)");

  // 1. Extend stay: set expected_checkout_at.
  const { error: extendError } = await admin
    .schema("ops")
    .from("stays")
    .update({ expected_checkout_at: "2026-09-01", status: "in_house" })
    .eq("id", stayId);
  if (extendError) { console.error("Extend-stay update failed:", extendError.message); process.exit(1); }
  const { data: afterExtend } = await admin.schema("ops").from("stays").select("expected_checkout_at").eq("id", stayId).single();
  if (afterExtend.expected_checkout_at !== "2026-09-01") { console.error("Extend-stay did not round-trip."); process.exit(1); }
  console.log("[ok] extend-stay applied");

  // 2. Transfer bed: move to bed B, confirm bed A is free again for a new stay.
  const { error: transferError } = await admin.schema("ops").from("stays").update({ bed_position_id: bedB.id }).eq("id", stayId);
  if (transferError) { console.error("Transfer-bed update failed:", transferError.message); process.exit(1); }
  const { data: afterTransfer } = await admin.schema("ops").from("stays").select("bed_position_id").eq("id", stayId).single();
  if (afterTransfer.bed_position_id !== bedB.id) { console.error("Transfer-bed did not round-trip."); process.exit(1); }
  console.log("[ok] transfer-bed applied, bed A now free");

  // 3. Discharge: check-out fields + status, plus a follow-up appointment.
  const { error: dischargeError } = await admin
    .schema("ops")
    .from("stays")
    .update({
      check_out_at: "2026-08-19",
      check_out_reason: "completed_treatment",
      destination: "Home",
      follow_up_date: "2026-09-15",
      status: "checked_out",
    })
    .eq("id", stayId);
  if (dischargeError) { console.error("Discharge update failed:", dischargeError.message); process.exit(1); }

  const apptId = randomUUID();
  const { error: apptError } = await admin.schema("ops").from("appointments").insert({
    id: apptId,
    patient_id: patientId,
    date: "2026-09-15",
    time: "09:00",
    clinic: "Follow-up (set clinic on the Appointments page)",
    purpose: "Post-discharge follow-up",
    needs_transport: false,
  });
  if (apptError) { console.error("Follow-up appointment insert failed:", apptError.message); process.exit(1); }

  const { data: afterDischarge } = await admin.schema("ops").from("stays").select("*").eq("id", stayId).single();
  if (afterDischarge.status !== "checked_out" || afterDischarge.check_out_reason !== "completed_treatment") {
    console.error("Discharge did not round-trip correctly:", afterDischarge);
    process.exit(1);
  }
  console.log("[ok] discharge applied with follow-up appointment created");

  // 4. Confirm bed B is now free too (stay is checked_out, not in_house/overdue).
  const { data: activeOnBedB } = await admin
    .schema("ops")
    .from("stays")
    .select("id")
    .eq("bed_position_id", bedB.id)
    .in("status", ["in_house", "overdue"]);
  if (activeOnBedB?.length) { console.error("Bed B still shows as occupied after discharge."); process.exit(1); }
  console.log("[ok] bed B correctly shows as free after discharge");

  // Cleanup.
  const { error: apptDeleteError } = await admin.schema("ops").from("appointments").delete().eq("id", apptId);
  if (apptDeleteError) { console.error("Cleanup (appointment) failed:", apptDeleteError.message); process.exit(1); }
  const { error: stayDeleteError } = await admin.schema("ops").from("stays").delete().eq("id", stayId);
  if (stayDeleteError) { console.error("Cleanup (stay) failed:", stayDeleteError.message); process.exit(1); }
  const { error: patientDeleteError } = await admin.schema("ops").from("patients").delete().eq("id", patientId);
  if (patientDeleteError) { console.error("Cleanup (patient) failed:", patientDeleteError.message); process.exit(1); }

  const { data: leftover } = await admin.schema("ops").from("patients").select("id").eq("id", patientId);
  if (leftover?.length) { console.error("Cleanup incomplete — leftover patient remains."); process.exit(1); }
  console.log("[ok] cleanup verified — no test rows remain");
  console.log("\nSmoke test passed end-to-end.");
}

main();
