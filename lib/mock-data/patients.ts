import type { Appointment, Carer, Patient, PatientStatus, Stay } from "@/lib/types/patient";
import { makeRng, TODAY_ISO } from "@/lib/utils/seeded-random";
import { bedPositions } from "@/lib/mock-data/house-ops";
import realPatients from "@/lib/mock-data/real/patients.json";
import realCarers from "@/lib/mock-data/real/carers.json";
import realDswdDelta from "@/lib/mock-data/real/patients-dswd-delta.json";

const rng = makeRng(202);

interface RealPatientRecord {
  id: string;
  patientNumber: string;
  firstName: string;
  lastName: string;
  birthDate: string | null;
  sex: string | null;
  rawAddress: string | null;
  provinceId: string | null;
  diagnosisIds: string[];
  treatmentPhaseId: string | null;
  status: PatientStatus;
  carerIds: string[];
  admittedAt: string | null;
  maritalStatus: string | null;
  remarks: string | null;
}

interface DswdDeltaRecord {
  patientId: string;
  religion: string | null;
  sectorCaseCategory: string | null;
  placeOfBirth: string | null;
  illnessType: string | null;
  sourceOfReferralText: string | null;
  reasonForReferral: string | null;
  socialProfileOfParent: string | null;
  servicesReceived: string | null;
  deathInfo: string | null;
  lengthOfStay: string | null;
}

// Enrichment fields from the DSWD Caseload Inventory sheet, synced from
// DATA/clean/patients-dswd-delta.json (see scripts/clean-dswd-data.py). Joined
// onto the patient master by patientId; patients with no DSWD-sheet match are
// left with these fields undefined, not fabricated.
const dswdByPatientId = new Map((realDswdDelta as DswdDeltaRecord[]).map((d) => [d.patientId, d]));

// Real patient master, synced from DATA/clean/patients.json (see scripts/sync-real-data.mjs
// and scripts/clean-real-data.py). Falls back to an empty list if that sync hasn't run.
export const patients: Patient[] = (realPatients as RealPatientRecord[]).map((p) => {
  const dswd = dswdByPatientId.get(p.id);
  return {
    id: p.id,
    patientNumber: p.patientNumber,
    firstName: p.firstName,
    lastName: p.lastName,
    birthDate: p.birthDate ?? undefined,
    sex: (p.sex === "F" ? "F" : "M") as "M" | "F",
    provinceId: p.provinceId ?? "",
    rawAddress: p.rawAddress ?? undefined,
    diagnosisIds: p.diagnosisIds,
    treatmentPhaseId: p.treatmentPhaseId ?? "",
    status: p.status,
    carerIds: p.carerIds,
    admittedAt: p.admittedAt ?? "",
    maritalStatus: p.maritalStatus ?? undefined,
    remarks: p.remarks ?? undefined,
    // The real FINAL_PATIENTS DATABASE this was cleaned from is entirely NCH-sourced.
    referringHospitalId: "hosp-nch",
    religion: dswd?.religion ?? undefined,
    sectorCaseCategory: dswd?.sectorCaseCategory ?? undefined,
    placeOfBirth: dswd?.placeOfBirth ?? undefined,
    illnessType: dswd?.illnessType ?? undefined,
    sourceOfReferralText: dswd?.sourceOfReferralText ?? undefined,
    reasonForReferral: dswd?.reasonForReferral ?? undefined,
    socialProfileOfParent: dswd?.socialProfileOfParent ?? undefined,
    servicesReceived: dswd?.servicesReceived ?? undefined,
    deathInfo: dswd?.deathInfo ?? undefined,
    lengthOfStay: dswd?.lengthOfStay ?? undefined,
  };
});

export const carers: Carer[] = realCarers as Carer[];

const carerIdByPatientId = new Map(carers.map((c) => [c.patientId, c.id]));

const availablePositions = bedPositions;

function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  const result = d.toISOString().slice(0, 10);
  return result > TODAY_ISO ? TODAY_ISO : result;
}

const DISCHARGE_DESTINATION: Partial<Record<PatientStatus, string>> = {
  completed: "Home province",
  expired: "Deceased",
  lost_to_follow_up: "Lost to follow-up",
};

export const stays: Stay[] = patients
  .filter((p) => p.status !== "non_pedia" && p.admittedAt)
  .map((p, i) => {
    const discharged = DISCHARGE_DESTINATION[p.status];
    const expected = rng.daysFromNow(rng.int(-5, 20));
    const carerId = carerIdByPatientId.get(p.id);

    if (discharged) {
      return {
        id: `stay-${p.id}`,
        patientId: p.id,
        bedPositionId: availablePositions[i % availablePositions.length].id,
        carerId,
        checkInAt: p.admittedAt,
        expectedCheckoutAt: expected,
        checkOutAt: addDays(p.admittedAt, rng.int(3, 60)),
        destination: discharged,
        status: "checked_out",
      } satisfies Stay;
    }

    const checkedOut = rng.bool(0.25);
    return {
      id: `stay-${p.id}`,
      patientId: p.id,
      bedPositionId: availablePositions[i % availablePositions.length].id,
      carerId,
      checkInAt: p.admittedAt,
      expectedCheckoutAt: expected,
      checkOutAt: checkedOut ? rng.daysFromNow(-rng.int(0, 3)) : undefined,
      destination: checkedOut ? "Home province" : undefined,
      status: checkedOut ? "checked_out" : expected < "2026-08-04" ? "overdue" : "in_house",
    } satisfies Stay;
  });

export const appointments: Appointment[] = patients.slice(0, 16).map((p, i) => ({
  id: `appt-${i + 1}`,
  patientId: p.id,
  date: rng.daysFromNow(rng.int(-2, 10)),
  time: rng.pick(["07:30", "08:00", "09:00", "10:30", "13:00", "14:00"]),
  clinic: rng.pick(["Pediatric Oncology Clinic", "Hematology Clinic", "Radiology", "Chemo Day Ward"]),
  purpose: rng.pick(["Chemo cycle", "Follow-up check-up", "Lab work", "Transfusion", "Consult"]),
  needsTransport: rng.bool(0.8),
}));
