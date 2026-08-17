"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";
import type { Patient, Carer, Stay, Appointment } from "@/lib/types/patient";

export type MutationResult = { ok: true } | { ok: false; error: string };

interface PatientRow {
  id: string;
  patient_number: string;
  first_name: string;
  last_name: string;
  birth_date: string | null;
  sex: "M" | "F";
  province_id: string | null;
  city_id: string | null;
  raw_address: string | null;
  patient_diagnoses: { diagnosis_id: string }[] | null;
  treatment_phase_id: string | null;
  status: Patient["status"];
  isolation_required: boolean | null;
  photo_consent_granted: boolean | null;
  admitted_at: string;
  marital_status: string | null;
  remarks: string | null;
  referring_hospital_id: string | null;
  religion: string | null;
  sector_case_category: string | null;
  place_of_birth: string | null;
  illness_type: string | null;
  source_of_referral_text: string | null;
  reason_for_referral: string | null;
  social_profile_of_parent: string | null;
  services_received: string | null;
  death_info: string | null;
  length_of_stay: string | null;
}

interface CarerRow {
  id: string;
  patient_id: string;
  name: string;
  relationship: string | null;
  mobile_number: string | null;
  effective_from: string;
  effective_to: string | null;
}

interface StayRow {
  id: string;
  patient_id: string;
  bed_position_id: string;
  carer_id: string | null;
  check_in_at: string;
  expected_checkout_at: string | null;
  check_out_at: string | null;
  check_out_reason: string | null;
  destination: string | null;
  follow_up_date: string | null;
  status: Stay["status"];
}

interface AppointmentRow {
  id: string;
  patient_id: string;
  date: string;
  time: string;
  clinic: string;
  purpose: string;
  needs_transport: boolean;
}

function toPatient(row: PatientRow, carerIds: string[]): Patient {
  return {
    id: row.id,
    patientNumber: row.patient_number,
    firstName: row.first_name,
    lastName: row.last_name,
    birthDate: row.birth_date ?? undefined,
    sex: row.sex,
    provinceId: row.province_id ?? "",
    cityId: row.city_id ?? undefined,
    rawAddress: row.raw_address ?? undefined,
    diagnosisIds: (row.patient_diagnoses ?? []).map((d: { diagnosis_id: string }) => d.diagnosis_id),
    treatmentPhaseId: row.treatment_phase_id ?? "",
    status: row.status,
    isolationRequired: row.isolation_required ?? undefined,
    photoConsentGranted: row.photo_consent_granted ?? undefined,
    carerIds,
    admittedAt: row.admitted_at,
    maritalStatus: row.marital_status ?? undefined,
    remarks: row.remarks ?? undefined,
    referringHospitalId: row.referring_hospital_id ?? undefined,
    religion: row.religion ?? undefined,
    sectorCaseCategory: row.sector_case_category ?? undefined,
    placeOfBirth: row.place_of_birth ?? undefined,
    illnessType: row.illness_type ?? undefined,
    sourceOfReferralText: row.source_of_referral_text ?? undefined,
    reasonForReferral: row.reason_for_referral ?? undefined,
    socialProfileOfParent: row.social_profile_of_parent ?? undefined,
    servicesReceived: row.services_received ?? undefined,
    deathInfo: row.death_info ?? undefined,
    lengthOfStay: row.length_of_stay ?? undefined,
  };
}

function fromPatient(p: Patient) {
  return {
    id: p.id,
    patient_number: p.patientNumber,
    first_name: p.firstName,
    last_name: p.lastName,
    birth_date: p.birthDate ?? null,
    sex: p.sex,
    province_id: p.provinceId || null,
    city_id: p.cityId ?? null,
    raw_address: p.rawAddress ?? null,
    treatment_phase_id: p.treatmentPhaseId || null,
    status: p.status,
    isolation_required: p.isolationRequired ?? null,
    photo_consent_granted: p.photoConsentGranted ?? null,
    admitted_at: p.admittedAt,
    marital_status: p.maritalStatus ?? null,
    remarks: p.remarks ?? null,
    referring_hospital_id: p.referringHospitalId ?? null,
    religion: p.religion ?? null,
    sector_case_category: p.sectorCaseCategory ?? null,
    place_of_birth: p.placeOfBirth ?? null,
    illness_type: p.illnessType ?? null,
    source_of_referral_text: p.sourceOfReferralText ?? null,
    reason_for_referral: p.reasonForReferral ?? null,
    social_profile_of_parent: p.socialProfileOfParent ?? null,
    services_received: p.servicesReceived ?? null,
    death_info: p.deathInfo ?? null,
    length_of_stay: p.lengthOfStay ?? null,
  };
}

function patientPatchToRow(patch: Partial<Patient>) {
  const row: Record<string, unknown> = {};
  if ("status" in patch) row.status = patch.status;
  if ("remarks" in patch) row.remarks = patch.remarks ?? null;
  if ("isolationRequired" in patch) row.isolation_required = patch.isolationRequired ?? null;
  if ("photoConsentGranted" in patch) row.photo_consent_granted = patch.photoConsentGranted ?? null;
  if ("maritalStatus" in patch) row.marital_status = patch.maritalStatus ?? null;
  return row;
}

function toCarer(row: CarerRow): Carer {
  return {
    id: row.id,
    patientId: row.patient_id,
    name: row.name,
    relationship: row.relationship ?? undefined,
    mobileNumber: row.mobile_number ?? undefined,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to ?? undefined,
  };
}

function fromCarer(c: Carer) {
  return {
    id: c.id,
    patient_id: c.patientId,
    name: c.name,
    relationship: c.relationship ?? null,
    mobile_number: c.mobileNumber ?? null,
    effective_from: c.effectiveFrom,
    effective_to: c.effectiveTo ?? null,
  };
}

function toStay(row: StayRow): Stay {
  return {
    id: row.id,
    patientId: row.patient_id,
    bedPositionId: row.bed_position_id,
    carerId: row.carer_id ?? undefined,
    checkInAt: row.check_in_at,
    expectedCheckoutAt: row.expected_checkout_at ?? undefined,
    checkOutAt: row.check_out_at ?? undefined,
    checkOutReason: row.check_out_reason ?? undefined,
    destination: row.destination ?? undefined,
    followUpDate: row.follow_up_date ?? undefined,
    status: row.status,
  };
}

function fromStay(s: Stay) {
  return {
    id: s.id,
    patient_id: s.patientId,
    bed_position_id: s.bedPositionId,
    carer_id: s.carerId ?? null,
    check_in_at: s.checkInAt,
    expected_checkout_at: s.expectedCheckoutAt ?? null,
    check_out_at: s.checkOutAt ?? null,
    check_out_reason: s.checkOutReason ?? null,
    destination: s.destination ?? null,
    follow_up_date: s.followUpDate ?? null,
    status: s.status,
  };
}

function stayPatchToRow(patch: Partial<Stay>) {
  const row: Record<string, unknown> = {};
  if ("checkOutAt" in patch) row.check_out_at = patch.checkOutAt ?? null;
  if ("checkOutReason" in patch) row.check_out_reason = patch.checkOutReason ?? null;
  if ("destination" in patch) row.destination = patch.destination ?? null;
  if ("followUpDate" in patch) row.follow_up_date = patch.followUpDate ?? null;
  if ("expectedCheckoutAt" in patch) row.expected_checkout_at = patch.expectedCheckoutAt ?? null;
  if ("bedPositionId" in patch) row.bed_position_id = patch.bedPositionId;
  if ("status" in patch) row.status = patch.status;
  return row;
}

function toAppointment(row: AppointmentRow): Appointment {
  return {
    id: row.id,
    patientId: row.patient_id,
    date: row.date,
    time: row.time,
    clinic: row.clinic,
    purpose: row.purpose,
    needsTransport: row.needs_transport,
  };
}

function fromAppointment(a: Appointment) {
  return {
    id: a.id,
    patient_id: a.patientId,
    date: a.date,
    time: a.time,
    clinic: a.clinic,
    purpose: a.purpose,
    needs_transport: a.needsTransport,
  };
}

/**
 * Real-backend replacement for the old localStorage-backed hook of the same
 * name. Interface is preserved on purpose (same field names, same add-item and
 * update-item shapes) so the ~10 pages already consuming this hook keep working unchanged
 * -- only the storage underneath moved from localStorage to `ops.*` in Supabase.
 */
export function usePatientsData() {
  const [patients, setPatients] = React.useState<Patient[]>([]);
  const [carers, setCarers] = React.useState<Carer[]>([]);
  const [stays, setStays] = React.useState<Stay[]>([]);
  const [appointments, setAppointments] = React.useState<Appointment[]>([]);
  const [loading, setLoading] = React.useState(true);

  const refetch = React.useCallback(async () => {
    const supabase = createClient();
    const [patientsRes, carersRes, staysRes, appointmentsRes] = await Promise.all([
      supabase.schema("ops").from("patients").select("*, patient_diagnoses(diagnosis_id)"),
      supabase.schema("ops").from("carers").select("*"),
      supabase.schema("ops").from("stays").select("*"),
      supabase.schema("ops").from("appointments").select("*"),
    ]);

    const carerRows = carersRes.data ?? [];
    const carerIdsByPatient = new Map<string, string[]>();
    for (const c of carerRows) {
      const list = carerIdsByPatient.get(c.patient_id) ?? [];
      list.push(c.id);
      carerIdsByPatient.set(c.patient_id, list);
    }

    setPatients((patientsRes.data ?? []).map((row) => toPatient(row, carerIdsByPatient.get(row.id) ?? [])));
    setCarers(carerRows.map(toCarer));
    setStays((staysRes.data ?? []).map(toStay));
    setAppointments((appointmentsRes.data ?? []).map(toAppointment));
    setLoading(false);
  }, []);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from Supabase, an external system
    refetch();
  }, [refetch]);

  async function addPatient(patient: Patient): Promise<MutationResult> {
    const supabase = createClient();
    const { error } = await supabase.schema("ops").from("patients").insert(fromPatient(patient));
    if (error) return { ok: false, error: error.message };
    if (patient.diagnosisIds.length > 0) {
      const { error: dxError } = await supabase
        .schema("ops")
        .from("patient_diagnoses")
        .insert(patient.diagnosisIds.map((diagnosisId) => ({ patient_id: patient.id, diagnosis_id: diagnosisId })));
      if (dxError) return { ok: false, error: dxError.message };
    }
    await refetch();
    return { ok: true };
  }

  async function addCarer(carer: Carer): Promise<MutationResult> {
    const supabase = createClient();
    const { error } = await supabase.schema("ops").from("carers").insert(fromCarer(carer));
    if (error) return { ok: false, error: error.message };
    await refetch();
    return { ok: true };
  }

  async function addStay(stay: Stay): Promise<MutationResult> {
    const supabase = createClient();
    const { error } = await supabase.schema("ops").from("stays").insert(fromStay(stay));
    if (error) return { ok: false, error: error.message };
    await refetch();
    return { ok: true };
  }

  async function addAppointment(appointment: Appointment): Promise<MutationResult> {
    const supabase = createClient();
    const { error } = await supabase.schema("ops").from("appointments").insert(fromAppointment(appointment));
    if (error) return { ok: false, error: error.message };
    await refetch();
    return { ok: true };
  }

  async function updatePatient(id: string, patch: Partial<Patient>): Promise<MutationResult> {
    const supabase = createClient();
    const { error } = await supabase.schema("ops").from("patients").update(patientPatchToRow(patch)).eq("id", id);
    if (error) return { ok: false, error: error.message };
    await refetch();
    return { ok: true };
  }

  async function updateStay(id: string, patch: Partial<Stay>): Promise<MutationResult> {
    const supabase = createClient();
    const { error } = await supabase.schema("ops").from("stays").update(stayPatchToRow(patch)).eq("id", id);
    if (error) return { ok: false, error: error.message };
    await refetch();
    return { ok: true };
  }

  return {
    patients,
    carers,
    stays,
    appointments,
    loading,
    addPatient,
    addCarer,
    addStay,
    addAppointment,
    updatePatient,
    updateStay,
    refetch,
  };
}
