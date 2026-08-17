// Regression smoke test for Phase 1.3 (admission document checklist +
// orientation topics). Exercises the exact shapes used by
// lib/hooks/use-patient-documents.ts and lib/hooks/use-orientation-topics.ts,
// including a real Storage upload/signed-url round trip, then deletes
// everything it created (including the uploaded object) so the DB and bucket
// are left exactly as found.
//
// Usage: node --env-file=.env.local scripts/smoke-test-admission-checklist.mjs

import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const { data: prov } = await admin.schema("ops").from("provinces").select("id").limit(1);
  const { data: staffRow } = await admin.schema("shared").from("staff").select("id").limit(1);
  if (!prov?.length || !staffRow?.length) {
    console.error("Missing reference data (province or staff).");
    process.exit(1);
  }
  const provinceId = prov[0].id;
  const staffId = staffRow[0].id;

  const patientId = randomUUID();
  const { error: patientError } = await admin.schema("ops").from("patients").insert({
    id: patientId,
    patient_number: `SMOKE-DOC-${Date.now()}`,
    first_name: "Doc",
    last_name: "Smoke Test",
    sex: "M",
    province_id: provinceId,
    status: "ongoing",
    admitted_at: "2026-08-18",
  });
  if (patientError) { console.error("Patient insert failed:", patientError.message); process.exit(1); }
  console.log("[ok] test patient created");

  // 1. Document: mark-collected path (no file).
  const { error: docError } = await admin.schema("ops").from("patient_documents").upsert(
    {
      patient_id: patientId,
      document_type: "signed_intake_form",
      collected_at: new Date().toISOString(),
      collected_by_staff_id: staffId,
    },
    { onConflict: "patient_id,document_type" }
  );
  if (docError) { console.error("Document upsert failed:", docError.message); process.exit(1); }
  console.log("[ok] document marked collected (no file)");

  // 2. Document: real file upload + signed URL round trip.
  const path = `${patientId}/patient_photo-${Date.now()}-test.txt`;
  const { error: uploadError } = await admin.storage
    .from("patient-documents")
    .upload(path, new Blob(["smoke test file"], { type: "text/plain" }), { upsert: true });
  if (uploadError) { console.error("Storage upload failed:", uploadError.message); process.exit(1); }

  const { error: docWithFileError } = await admin.schema("ops").from("patient_documents").upsert(
    {
      patient_id: patientId,
      document_type: "patient_photo",
      storage_path: path,
      collected_at: new Date().toISOString(),
      collected_by_staff_id: staffId,
    },
    { onConflict: "patient_id,document_type" }
  );
  if (docWithFileError) { console.error("Document-with-file upsert failed:", docWithFileError.message); process.exit(1); }

  const { data: signedUrlData, error: signedUrlError } = await admin.storage
    .from("patient-documents")
    .createSignedUrl(path, 60);
  if (signedUrlError || !signedUrlData?.signedUrl) {
    console.error("Signed URL creation failed:", signedUrlError?.message ?? "no URL returned");
    process.exit(1);
  }
  console.log("[ok] file uploaded and signed URL generated");

  // 3. Orientation topic: add, check for this patient, uncheck, remove.
  const { data: topicInsert, error: topicError } = await admin
    .schema("ops")
    .from("orientation_topics")
    .insert({ topic: "Smoke test topic — safe to ignore", sort_order: 999 })
    .select("id")
    .single();
  if (topicError) { console.error("Topic insert failed:", topicError.message); process.exit(1); }
  const topicId = topicInsert.id;

  const { error: checkError } = await admin.schema("ops").from("patient_orientation_checks").upsert(
    { patient_id: patientId, topic_id: topicId, covered_at: new Date().toISOString(), covered_by_staff_id: staffId },
    { onConflict: "patient_id,topic_id" }
  );
  if (checkError) { console.error("Orientation check upsert failed:", checkError.message); process.exit(1); }

  const { data: checkReadBack } = await admin
    .schema("ops")
    .from("patient_orientation_checks")
    .select("*")
    .eq("patient_id", patientId)
    .eq("topic_id", topicId)
    .single();
  if (!checkReadBack) { console.error("Orientation check did not round-trip."); process.exit(1); }
  console.log("[ok] orientation topic added and checked for patient");

  // 4. Cleanup, in FK-safe order.
  await admin.storage.from("patient-documents").remove([path]);
  const { error: checksDeleteError } = await admin.schema("ops").from("patient_orientation_checks").delete().eq("patient_id", patientId);
  if (checksDeleteError) { console.error("Cleanup (checks) failed:", checksDeleteError.message); process.exit(1); }
  const { error: topicDeleteError } = await admin.schema("ops").from("orientation_topics").delete().eq("id", topicId);
  if (topicDeleteError) { console.error("Cleanup (topic) failed:", topicDeleteError.message); process.exit(1); }
  const { error: docsDeleteError } = await admin.schema("ops").from("patient_documents").delete().eq("patient_id", patientId);
  if (docsDeleteError) { console.error("Cleanup (documents) failed:", docsDeleteError.message); process.exit(1); }
  const { error: patientDeleteError } = await admin.schema("ops").from("patients").delete().eq("id", patientId);
  if (patientDeleteError) { console.error("Cleanup (patient) failed:", patientDeleteError.message); process.exit(1); }

  const { data: leftoverPatient } = await admin.schema("ops").from("patients").select("id").eq("id", patientId);
  const { data: leftoverFile } = await admin.storage.from("patient-documents").list(patientId);
  if (leftoverPatient?.length || leftoverFile?.length) {
    console.error("Cleanup incomplete — leftover test rows/files remain.");
    process.exit(1);
  }
  console.log("[ok] cleanup verified — no test rows or files remain");
  console.log("\nSmoke test passed end-to-end.");
}

main();
