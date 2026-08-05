import type { Appointment, Carer, Patient, PatientStatus, Referral, Stay } from "@/lib/types/patient";
import { makeRng } from "@/lib/utils/seeded-random";
import { cities, diagnoses, treatmentPhases } from "@/lib/mock-data/reference-data";
import { bedPositions } from "@/lib/mock-data/house-ops";

const rng = makeRng(202);

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

const statusPool: PatientStatus[] = [
  "ongoing", "ongoing", "ongoing", "ongoing", "ongoing", "check_up", "check_up",
  "completed", "lost_to_follow_up", "expired", "non_pedia",
];

export const patients: Patient[] = Array.from({ length: 24 }).map((_, i) => {
  const city = rng.pick(cities);
  const ageYears = rng.int(1, 17);
  const birthDate = rng.daysFromNow(-ageYears * 365 - rng.int(0, 364));
  const dxCount = rng.bool(0.85) ? 1 : 2;
  return {
    id: `pt-${i + 1}`,
    patientNumber: `CL-${String(1000 + i)}`,
    firstName: rng.pick(firstNames),
    lastName: rng.pick(lastNames),
    birthDate,
    sex: rng.pick(["M", "F"] as const),
    provinceId: city.provinceId,
    cityId: city.id,
    diagnosisIds: rng.pickN(diagnoses, dxCount).map((d) => d.id),
    treatmentPhaseId: rng.pick(treatmentPhases).id,
    status: rng.pick(statusPool),
    isolationRequired: rng.bool(0.1),
    photoConsentGranted: rng.bool(0.75),
    carerIds: [`carer-${i + 1}`],
    admittedAt: rng.daysFromNow(-rng.int(10, 500)),
  };
});

export const carers: Carer[] = patients.map((p, i) => ({
  id: `carer-${i + 1}`,
  patientId: p.id,
  name: `${rng.pick(["Maria", "Josefa", "Rosario", "Teresa", "Corazon"])} ${p.lastName}`,
  relationship: rng.pick(["Mother", "Father", "Grandmother", "Aunt", "Guardian"]),
  mobileNumber: `09${rng.int(10, 99)}${rng.int(1000000, 9999999)}`,
  effectiveFrom: p.admittedAt,
}));

export const referrals: Referral[] = Array.from({ length: 14 }).map((_, i) => ({
  id: `ref-${i + 1}`,
  patientName: `${rng.pick(firstNames)} ${rng.pick(lastNames)}`,
  referringPerson: rng.pick(["Dr. Aquino (NCH Onco)", "Dr. Bautista (NCH Hema)", "NCH Medical Social Service", "Dr. Reyes (NCH Onco)"]),
  department: rng.pick(["Pediatric Oncology", "Pediatric Hematology", "Medical Social Service"]),
  urgency: rng.pick(["routine", "routine", "urgent", "emergency"] as const),
  date: rng.daysFromNow(-rng.int(0, 30)),
  status: rng.pick(["submitted", "submitted", "approved", "waitlisted", "declined"] as const),
  reason: rng.bool(0.3) ? "No open bed position matching isolation need" : undefined,
}));

const availablePositions = bedPositions;

export const stays: Stay[] = patients
  .filter((p) => p.status === "ongoing" || p.status === "check_up")
  .map((p, i) => {
    const checkedOut = rng.bool(0.25);
    const expected = rng.daysFromNow(rng.int(-5, 20));
    return {
      id: `stay-${p.id}`,
      patientId: p.id,
      bedPositionId: availablePositions[i % availablePositions.length].id,
      carerId: `carer-${p.id.split("-")[1]}`,
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
