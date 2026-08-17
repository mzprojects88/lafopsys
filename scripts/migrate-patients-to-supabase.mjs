// One-time migration: moves the 169 real patients + carers (already cleaned
// by clean-real-data.py, DSWD-enriched by clean-dswd-data.py) from the
// gitignored lib/mock-data/real/*.json snapshot into ops.patients/ops.carers/
// ops.patient_diagnoses in the real Supabase backend.
//
// ops.patients.id is a UUID (Postgres-native, consistent with every other
// real table added this session), not the mock "pt-real-N" scheme -- a fresh
// UUID is generated per patient here and carers/diagnoses are linked through
// it. The human-facing identifier (patient_number) is preserved as its own
// column, which is what actually matters for real-world lookup, not the
// internal DB id.
//
// Idempotent by patient_number: skips any patient_number already present in
// ops.patients rather than creating a duplicate on re-run.
//
// Usage: node --env-file=.env.local scripts/migrate-patients-to-supabase.mjs

import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import patientsJson from "../lib/mock-data/real/patients.json" with { type: "json" };
import carersJson from "../lib/mock-data/real/carers.json" with { type: "json" };
import dswdJson from "../lib/mock-data/real/patients-dswd-delta.json" with { type: "json" };

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local.");
  process.exit(1);
}

const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

function nullIfEmpty(v) {
  return v === undefined || v === null || v === "" ? null : v;
}

async function main() {
  const { data: existing, error: existingError } = await admin
    .schema("ops")
    .from("patients")
    .select("id, patient_number");
  if (existingError) {
    console.error("Failed to check existing patients:", existingError.message);
    process.exit(1);
  }
  // Keyed by patient_number (the stable human-facing id), not the mock "pt-real-N"
  // id -- covers patients inserted by an earlier, possibly-partial run of this
  // script, so a re-run's carer/diagnosis linking works even when zero new
  // patient rows are inserted this time.
  const patientNumberToId = new Map(existing.map((p) => [p.patient_number, p.id]));

  const dswdByPatientId = new Map(dswdJson.map((d) => [d.patientId, d]));
  const carersByPatientId = new Map();
  for (const c of carersJson) {
    if (!carersByPatientId.has(c.patientId)) carersByPatientId.set(c.patientId, []);
    carersByPatientId.get(c.patientId).push(c);
  }

  // Every patient's mock "id" -> real DB id, whether inserted just now or by
  // an earlier run -- carer linking below needs the complete mapping either way.
  const oldIdToNewId = new Map();
  const patientRows = [];
  const patientDiagnosisRows = [];
  let skippedExisting = 0;

  for (const p of patientsJson) {
    const existingId = patientNumberToId.get(p.patientNumber);
    if (existingId) {
      oldIdToNewId.set(p.id, existingId);
      skippedExisting++;
      continue;
    }
    const newId = randomUUID();
    oldIdToNewId.set(p.id, newId);
    const dswd = dswdByPatientId.get(p.id);

    patientRows.push({
      id: newId,
      patient_number: p.patientNumber,
      first_name: p.firstName,
      last_name: p.lastName,
      birth_date: nullIfEmpty(p.birthDate),
      sex: p.sex,
      province_id: nullIfEmpty(p.provinceId),
      city_id: nullIfEmpty(p.cityId),
      raw_address: nullIfEmpty(p.rawAddress),
      treatment_phase_id: nullIfEmpty(p.treatmentPhaseId),
      status: p.status,
      isolation_required: p.isolationRequired ?? null,
      photo_consent_granted: p.photoConsentGranted ?? null,
      admitted_at: p.admittedAt,
      marital_status: nullIfEmpty(p.maritalStatus),
      remarks: nullIfEmpty(p.remarks),
      referring_hospital_id: "hosp-nch", // the source patient master is entirely NCH-sourced, see lib/mock-data/patients.ts
      religion: nullIfEmpty(dswd?.religion),
      sector_case_category: nullIfEmpty(dswd?.sectorCaseCategory),
      place_of_birth: nullIfEmpty(dswd?.placeOfBirth),
      illness_type: nullIfEmpty(dswd?.illnessType),
      source_of_referral_text: nullIfEmpty(dswd?.sourceOfReferralText),
      reason_for_referral: nullIfEmpty(dswd?.reasonForReferral),
      social_profile_of_parent: nullIfEmpty(dswd?.socialProfileOfParent),
      services_received: nullIfEmpty(dswd?.servicesReceived),
      death_info: nullIfEmpty(dswd?.deathInfo),
      length_of_stay: nullIfEmpty(dswd?.lengthOfStay),
    });

    for (const dxId of p.diagnosisIds) {
      patientDiagnosisRows.push({ patient_id: newId, diagnosis_id: dxId });
    }
  }

  // Batch inserts (Supabase/PostgREST handles large arrays fine, but chunk
  // defensively in case of payload-size limits on a very large future dataset).
  const CHUNK = 100;

  if (patientRows.length > 0) {
    for (let i = 0; i < patientRows.length; i += CHUNK) {
      const { error } = await admin.schema("ops").from("patients").insert(patientRows.slice(i, i + CHUNK));
      if (error) {
        console.error(`Patient insert failed at chunk starting ${i}:`, error.message);
        process.exit(1);
      }
    }
    console.log(`Inserted ${patientRows.length} patients (${skippedExisting} already existed, skipped).`);

    for (let i = 0; i < patientDiagnosisRows.length; i += CHUNK) {
      const { error } = await admin.schema("ops").from("patient_diagnoses").insert(patientDiagnosisRows.slice(i, i + CHUNK));
      if (error) {
        console.error(`patient_diagnoses insert failed at chunk starting ${i}:`, error.message);
        process.exit(1);
      }
    }
    console.log(`Inserted ${patientDiagnosisRows.length} patient-diagnosis links.`);
  } else {
    console.log(`No new patients — all ${skippedExisting} already present in ops.patients.`);
  }

  // Carers: idempotent by skipping any patient that already has at least one
  // carer row, rather than assuming "patients were new this run" -- a prior
  // run may have inserted patients successfully but failed partway through
  // carers (exactly what happened once during development of this script).
  const { data: existingCarerPatientIds, error: carerLookupError } = await admin
    .schema("ops")
    .from("carers")
    .select("patient_id");
  if (carerLookupError) {
    console.error("Failed to check existing carers:", carerLookupError.message);
    process.exit(1);
  }
  const patientsWithCarers = new Set(existingCarerPatientIds.map((c) => c.patient_id));

  const carerRows = [];
  let skippedCarerPatients = 0;
  for (const [oldPatientId, newPatientId] of oldIdToNewId) {
    if (patientsWithCarers.has(newPatientId)) {
      skippedCarerPatients++;
      continue;
    }
    const carers = carersByPatientId.get(oldPatientId) ?? [];
    for (const c of carers) {
      carerRows.push({
        id: randomUUID(),
        patient_id: newPatientId,
        name: c.name,
        relationship: nullIfEmpty(c.relationship),
        mobile_number: nullIfEmpty(c.mobileNumber),
        effective_from: c.effectiveFrom,
        effective_to: nullIfEmpty(c.effectiveTo),
      });
    }
  }
  for (let i = 0; i < carerRows.length; i += CHUNK) {
    const { error } = await admin.schema("ops").from("carers").insert(carerRows.slice(i, i + CHUNK));
    if (error) {
      console.error(`Carer insert failed at chunk starting ${i}:`, error.message);
      process.exit(1);
    }
  }
  console.log(`Inserted ${carerRows.length} carers (${skippedCarerPatients} patients already had carers on file, skipped).`);
}

main();
