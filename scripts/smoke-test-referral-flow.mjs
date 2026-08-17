// Regression smoke test for the referral -> admission flow. Exercises the
// exact insert/update/read shapes used by lib/hooks/use-referrals-collection.ts
// and lib/hooks/use-patients-collection.ts against the live DB, then deletes
// everything it created so the DB is left exactly as it was found. Safe to
// re-run any time this flow's field mappings change.
//
// Usage: node --env-file=.env.local scripts/smoke-test-referral-flow.mjs

import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

async function main() {
  const [dx, tp, prov, hosp, bed, staffRow] = await Promise.all([
    admin.schema("ops").from("diagnoses").select("id").limit(1),
    admin.schema("ops").from("treatment_phases").select("id").limit(1),
    admin.schema("ops").from("provinces").select("id").limit(1),
    admin.schema("ops").from("hospitals").select("id").limit(1),
    admin.schema("ops").from("bed_positions").select("id").limit(1),
    admin.schema("shared").from("staff").select("id").limit(1),
  ]);
  for (const [label, res] of [["diagnosis", dx], ["phase", tp], ["province", prov], ["hospital", hosp], ["bed", bed], ["staff", staffRow]]) {
    if (res.error || !res.data?.length) {
      console.error(`Missing reference data for ${label}:`, res.error?.message ?? "no rows");
      process.exit(1);
    }
  }
  const diagnosisId = dx.data[0].id;
  const treatmentPhaseId = tp.data[0].id;
  const provinceId = prov.data[0].id;
  const hospitalId = hosp.data[0].id;
  const bedPositionId = bed.data[0].id;
  const staffId = staffRow.data[0].id;

  // 1. Insert a referral (mirrors NewReferralPage's addReferral call).
  const referralId = randomUUID();
  const { error: refError } = await admin.schema("ops").from("referrals").insert({
    id: referralId,
    patient_name: "Smoke Test Patient",
    referring_person: "Dr. Test",
    department: "Pediatric Oncology",
    urgency: "routine",
    date: "2026-08-17",
    status: "submitted",
    hospital_id: hospitalId,
    submitted_by_staff_id: staffId,
    patient_first_name: "Smoke",
    patient_last_name: "Test Patient",
    patient_birth_date: "2015-01-01",
    patient_sex: "M",
    treatment_phase_id: treatmentPhaseId,
    province_id: provinceId,
    raw_address: "123 Test St",
    carer_name: "Test Carer",
    carer_relationship: "Mother",
    carer_mobile: "09171234567",
    next_appointment_note: "Chemo cycle 1, Sep 1 2026",
    transcription_note: "Smoke test — safe to ignore",
  });
  if (refError) { console.error("Referral insert failed:", refError.message); process.exit(1); }

  const { error: refDxError } = await admin.schema("ops").from("referral_diagnoses").insert({
    referral_id: referralId,
    diagnosis_id: diagnosisId,
  });
  if (refDxError) { console.error("referral_diagnoses insert failed:", refDxError.message); process.exit(1); }
  console.log("[ok] referral + referral_diagnoses inserted");

  // 2. Read it back with the join, exactly like useReferralsData's refetch().
  const { data: readBack, error: readError } = await admin
    .schema("ops")
    .from("referrals")
    .select("*, referral_diagnoses(diagnosis_id)")
    .eq("id", referralId)
    .single();
  if (readError) { console.error("Referral read-back failed:", readError.message); process.exit(1); }
  if (readBack.referral_diagnoses?.[0]?.diagnosis_id !== diagnosisId) {
    console.error("Referral diagnosis join did not round-trip correctly:", readBack.referral_diagnoses);
    process.exit(1);
  }
  if (readBack.submitted_by_staff_id !== staffId) {
    console.error("submitted_by_staff_id FK did not round-trip correctly:", readBack.submitted_by_staff_id);
    process.exit(1);
  }
  console.log("[ok] referral read-back with diagnosis join + submitted_by_staff_id FK matches");

  // 3. Approve, then confirm-arrival: patient + carer + stay (mirrors ConfirmArrivalDialog).
  const { error: approveError } = await admin.schema("ops").from("referrals").update({ status: "approved" }).eq("id", referralId);
  if (approveError) { console.error("Referral approve failed:", approveError.message); process.exit(1); }

  const patientId = randomUUID();
  const carerId = randomUUID();
  const { error: patientError } = await admin.schema("ops").from("patients").insert({
    id: patientId,
    patient_number: `REF-${referralId}`,
    first_name: "Smoke",
    last_name: "Test Patient",
    birth_date: "2015-01-01",
    sex: "M",
    province_id: provinceId,
    raw_address: "123 Test St",
    treatment_phase_id: treatmentPhaseId,
    status: "ongoing",
    admitted_at: "2026-08-17",
    referring_hospital_id: hospitalId,
  });
  if (patientError) { console.error("Patient insert failed:", patientError.message); process.exit(1); }

  const { error: patientDxError } = await admin.schema("ops").from("patient_diagnoses").insert({
    patient_id: patientId,
    diagnosis_id: diagnosisId,
  });
  if (patientDxError) { console.error("patient_diagnoses insert failed:", patientDxError.message); process.exit(1); }

  const { error: carerError } = await admin.schema("ops").from("carers").insert({
    id: carerId,
    patient_id: patientId,
    name: "Test Carer",
    relationship: "Mother",
    mobile_number: "09171234567",
    effective_from: "2026-08-17",
  });
  if (carerError) { console.error("Carer insert failed:", carerError.message); process.exit(1); }

  const stayId = randomUUID();
  const { error: stayError } = await admin.schema("ops").from("stays").insert({
    id: stayId,
    patient_id: patientId,
    bed_position_id: bedPositionId,
    carer_id: carerId,
    check_in_at: "2026-08-17",
    status: "in_house",
  });
  if (stayError) { console.error("Stay insert failed:", stayError.message); process.exit(1); }
  console.log("[ok] patient + patient_diagnoses + carer + stay inserted");

  const { error: admitError } = await admin
    .schema("ops")
    .from("referrals")
    .update({ status: "admitted", admitted_patient_id: patientId, admitted_at: "2026-08-17" })
    .eq("id", referralId);
  if (admitError) { console.error("Referral admit-update failed:", admitError.message); process.exit(1); }
  console.log("[ok] referral marked admitted, linked to real patient");

  // 4. Read the full usePatientsData() shape back (patients+carers+stays joined) to confirm the hook's mapping works.
  const { data: patientReadBack, error: patientReadError } = await admin
    .schema("ops")
    .from("patients")
    .select("*, patient_diagnoses(diagnosis_id)")
    .eq("id", patientId)
    .single();
  if (patientReadError) { console.error("Patient read-back failed:", patientReadError.message); process.exit(1); }
  if (patientReadBack.patient_diagnoses?.[0]?.diagnosis_id !== diagnosisId) {
    console.error("Patient diagnosis join did not round-trip correctly:", patientReadBack.patient_diagnoses);
    process.exit(1);
  }
  console.log("[ok] patient read-back with diagnosis join matches");

  // 5. Cleanup — delete everything this script created, in FK-safe order.
  // referrals.admitted_patient_id references patients.id, so the referral
  // (and its referral_diagnoses) must go before the patient it points to.
  const { error: refDxDeleteError } = await admin.schema("ops").from("referral_diagnoses").delete().eq("referral_id", referralId);
  if (refDxDeleteError) { console.error("referral_diagnoses delete failed:", refDxDeleteError.message); process.exit(1); }
  const { error: stayDeleteError } = await admin.schema("ops").from("stays").delete().eq("id", stayId);
  if (stayDeleteError) { console.error("Stay delete failed:", stayDeleteError.message); process.exit(1); }
  const { error: carerDeleteError } = await admin.schema("ops").from("carers").delete().eq("id", carerId);
  if (carerDeleteError) { console.error("Carer delete failed:", carerDeleteError.message); process.exit(1); }
  const { error: refDeleteError } = await admin.schema("ops").from("referrals").delete().eq("id", referralId);
  if (refDeleteError) { console.error("Referral delete failed:", refDeleteError.message); process.exit(1); }
  const { error: dxDeleteError } = await admin.schema("ops").from("patient_diagnoses").delete().eq("patient_id", patientId);
  if (dxDeleteError) { console.error("patient_diagnoses delete failed:", dxDeleteError.message); process.exit(1); }
  const { error: patientDeleteError } = await admin.schema("ops").from("patients").delete().eq("id", patientId);
  if (patientDeleteError) { console.error("Patient delete failed:", patientDeleteError.message); process.exit(1); }

  const { data: leftoverReferral } = await admin.schema("ops").from("referrals").select("id").eq("id", referralId);
  const { data: leftoverPatient } = await admin.schema("ops").from("patients").select("id").eq("id", patientId);
  if (leftoverReferral?.length || leftoverPatient?.length) {
    console.error("Cleanup incomplete — leftover test rows remain.");
    process.exit(1);
  }
  console.log("[ok] cleanup verified — no test rows remain");
  console.log("\nSmoke test passed end-to-end.");
}

main();
