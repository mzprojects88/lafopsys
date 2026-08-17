"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";
import type { Referral } from "@/lib/types/patient";

export type MutationResult = { ok: true } | { ok: false; error: string };

interface ReferralRow {
  id: string;
  patient_name: string;
  referring_person: string;
  department: string;
  urgency: Referral["urgency"];
  date: string;
  status: Referral["status"];
  reason: string | null;
  hospital_id: string | null;
  patient_first_name: string | null;
  patient_last_name: string | null;
  patient_birth_date: string | null;
  patient_sex: "M" | "F" | null;
  referral_diagnoses: { diagnosis_id: string }[] | null;
  treatment_phase_id: string | null;
  province_id: string | null;
  raw_address: string | null;
  carer_name: string | null;
  carer_relationship: string | null;
  carer_mobile: string | null;
  next_appointment_note: string | null;
  transcription_note: string | null;
  submitted_by_staff_id: string | null;
  admitted_patient_id: string | null;
  admitted_at: string | null;
}

function toReferral(row: ReferralRow): Referral {
  return {
    id: row.id,
    patientName: row.patient_name,
    referringPerson: row.referring_person,
    department: row.department,
    urgency: row.urgency,
    date: row.date,
    status: row.status,
    reason: row.reason ?? undefined,
    hospitalId: row.hospital_id ?? undefined,
    patientFirstName: row.patient_first_name ?? undefined,
    patientLastName: row.patient_last_name ?? undefined,
    patientBirthDate: row.patient_birth_date ?? undefined,
    patientSex: row.patient_sex ?? undefined,
    diagnosisIds: (row.referral_diagnoses ?? []).map((d: { diagnosis_id: string }) => d.diagnosis_id),
    treatmentPhaseId: row.treatment_phase_id ?? undefined,
    provinceId: row.province_id ?? undefined,
    rawAddress: row.raw_address ?? undefined,
    carerName: row.carer_name ?? undefined,
    carerRelationship: row.carer_relationship ?? undefined,
    carerMobile: row.carer_mobile ?? undefined,
    nextAppointmentNote: row.next_appointment_note ?? undefined,
    transcriptionNote: row.transcription_note ?? undefined,
    submittedByStaffId: row.submitted_by_staff_id ?? undefined,
    admittedPatientId: row.admitted_patient_id ?? undefined,
    admittedAt: row.admitted_at ?? undefined,
  };
}

function fromReferral(r: Referral) {
  return {
    id: r.id,
    patient_name: r.patientName,
    referring_person: r.referringPerson,
    department: r.department,
    urgency: r.urgency,
    date: r.date,
    status: r.status,
    reason: r.reason ?? null,
    hospital_id: r.hospitalId ?? null,
    submitted_by_staff_id: r.submittedByStaffId ?? null,
    patient_first_name: r.patientFirstName ?? null,
    patient_last_name: r.patientLastName ?? null,
    patient_birth_date: r.patientBirthDate ?? null,
    patient_sex: r.patientSex ?? null,
    treatment_phase_id: r.treatmentPhaseId ?? null,
    province_id: r.provinceId ?? null,
    raw_address: r.rawAddress ?? null,
    carer_name: r.carerName ?? null,
    carer_relationship: r.carerRelationship ?? null,
    carer_mobile: r.carerMobile ?? null,
    next_appointment_note: r.nextAppointmentNote ?? null,
    transcription_note: r.transcriptionNote ?? null,
    admitted_patient_id: r.admittedPatientId ?? null,
    admitted_at: r.admittedAt ?? null,
  };
}

function referralPatchToRow(patch: Partial<Referral>) {
  const row: Record<string, unknown> = {};
  if ("status" in patch) row.status = patch.status;
  if ("reason" in patch) row.reason = patch.reason ?? null;
  if ("admittedPatientId" in patch) row.admitted_patient_id = patch.admittedPatientId ?? null;
  if ("admittedAt" in patch) row.admitted_at = patch.admittedAt ?? null;
  return row;
}

/** Real-backend replacement for `useLocalCollection<Referral>("referrals", ...)`, against `ops.referrals`. */
export function useReferralsData() {
  const [referrals, setReferrals] = React.useState<Referral[]>([]);
  const [loading, setLoading] = React.useState(true);

  const refetch = React.useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .schema("ops")
      .from("referrals")
      .select("*, referral_diagnoses(diagnosis_id)")
      .order("date", { ascending: false });
    setReferrals((data ?? []).map(toReferral));
    setLoading(false);
  }, []);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from Supabase, an external system
    refetch();
  }, [refetch]);

  async function addReferral(referral: Referral): Promise<MutationResult> {
    const supabase = createClient();
    const { error } = await supabase.schema("ops").from("referrals").insert(fromReferral(referral));
    if (error) return { ok: false, error: error.message };
    if (referral.diagnosisIds && referral.diagnosisIds.length > 0) {
      const { error: dxError } = await supabase
        .schema("ops")
        .from("referral_diagnoses")
        .insert(referral.diagnosisIds.map((diagnosisId) => ({ referral_id: referral.id, diagnosis_id: diagnosisId })));
      if (dxError) return { ok: false, error: dxError.message };
    }
    await refetch();
    return { ok: true };
  }

  async function updateReferral(id: string, patch: Partial<Referral>): Promise<MutationResult> {
    const supabase = createClient();
    const { error } = await supabase.schema("ops").from("referrals").update(referralPatchToRow(patch)).eq("id", id);
    if (error) return { ok: false, error: error.message };
    await refetch();
    return { ok: true };
  }

  return { referrals, loading, addReferral, updateReferral, refetch };
}
