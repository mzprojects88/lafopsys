import type { Appointment, Carer, Patient, PatientStatus, Referral, Stay } from "@/lib/types/patient";
import { makeRng, TODAY_ISO } from "@/lib/utils/seeded-random";
import { bedPositions } from "@/lib/mock-data/house-ops";
import { hospitals, hospitalNurses } from "@/lib/mock-data/hospitals";
import { diagnoses, treatmentPhases, provinces } from "@/lib/mock-data/reference-data";
import realPatients from "@/lib/mock-data/real/patients.json";
import realCarers from "@/lib/mock-data/real/carers.json";

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

// Real patient master, synced from DATA/clean/patients.json (see scripts/sync-real-data.mjs
// and scripts/clean-real-data.py). Falls back to an empty list if that sync hasn't run.
export const patients: Patient[] = (realPatients as RealPatientRecord[]).map((p) => ({
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
}));

export const carers: Carer[] = realCarers as Carer[];

const carerIdByPatientId = new Map(carers.map((c) => [c.patientId, c.id]));

const firstNames = [
  "Kieth Xander", "Ella Marie", "John Paul", "Angel Grace", "Mark Anthony", "Princess Joy",
  "Josh Emmanuel", "Aira Nicole", "Rafael", "Maricel", "Dave", "Kyla", "Vince", "Nicole",
  "Justin", "Trisha", "Kurt", "Danica", "Adrian", "Faith", "Renz", "Bea", "Elijah", "Samantha", "Miguel",
];
const lastNames = [
  "Carpio", "Reyes", "Santos", "Cruz", "Bautista", "Gonzales", "Mendoza", "Torres", "Ramos",
  "Flores", "Aquino", "Castillo", "Villanueva", "Del Rosario", "Garcia", "Rivera", "Domingo",
  "Fernandez", "Pascual", "Marquez",
];

export const referrals: Referral[] = Array.from({ length: 14 }).map((_, i) => {
  const fromHospital = i < 6; // seed the first 6 as if submitted through the partner hospital portal
  const patientFirstName = rng.pick(firstNames);
  const patientLastName = rng.pick(lastNames);
  const hospital = fromHospital ? hospitals[i % hospitals.length] : undefined;
  const nurse = hospital ? rng.pick(hospitalNurses.filter((n) => n.hospitalId === hospital.id)) : undefined;

  return {
    id: `ref-${i + 1}`,
    patientName: `${patientFirstName} ${patientLastName}`,
    referringPerson: nurse
      ? `${nurse.firstName} ${nurse.lastName} (${hospital!.code})`
      : rng.pick(["Dr. Aquino (NCH Onco)", "Dr. Bautista (NCH Hema)", "NCH Medical Social Service", "Dr. Reyes (NCH Onco)"]),
    department: rng.pick(["Pediatric Oncology", "Pediatric Hematology", "Medical Social Service"]),
    urgency: rng.pick(["routine", "routine", "urgent", "emergency"] as const),
    date: rng.daysFromNow(-rng.int(0, 30)),
    status: rng.pick(["submitted", "submitted", "approved", "waitlisted", "declined"] as const),
    reason: rng.bool(0.3) ? "No open bed position matching isolation need" : undefined,
    ...(fromHospital && {
      hospitalId: hospital!.id,
      submittedByNurseId: nurse?.id,
      patientFirstName,
      patientLastName,
      patientBirthDate: rng.daysFromNow(-rng.int(1, 17) * 365 - rng.int(0, 364)),
      patientSex: rng.pick(["M", "F"] as const),
      diagnosisIds: [rng.pick(diagnoses).id],
      treatmentPhaseId: rng.pick(treatmentPhases).id,
      provinceId: rng.pick(provinces).id,
      rawAddress: rng.pick(["Brgy. San Isidro, Antipolo", "Purok 3, Binangonan", "Brgy. Poblacion, San Pedro", "Brgy. Sto. Niño, Marikina"]),
      carerName: `${rng.pick(["Maria", "Josefa", "Rosario", "Teresa", "Corazon"])} ${patientLastName}`,
      carerRelationship: rng.pick(["Mother", "Father", "Grandmother", "Aunt", "Guardian"]),
      carerMobile: `09${rng.int(10, 99)}${rng.int(1000000, 9999999)}`,
    }),
  } satisfies Referral;
});

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
