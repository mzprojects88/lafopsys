import type { Hospital, HospitalNurse } from "@/lib/types/hospital";

export const hospitals: Hospital[] = [
  { id: "hosp-nch", name: "National Children's Hospital", code: "NCH", address: "Banawe, Quezon City" },
  { id: "hosp-pgh", name: "Philippine General Hospital", code: "PGH", address: "Taft Ave, Manila" },
];

export const hospitalNurses: HospitalNurse[] = [
  { id: "nurse-1", hospitalId: "hosp-nch", firstName: "Liza", lastName: "Marquez", position: "Pediatric Oncology Nurse", active: true },
  { id: "nurse-2", hospitalId: "hosp-nch", firstName: "Ramil", lastName: "Cortez", position: "Medical Social Worker", active: true },
  { id: "nurse-3", hospitalId: "hosp-nch", firstName: "Divina", lastName: "Ocampo", position: "Pediatric Hematology Nurse", active: true },
  { id: "nurse-4", hospitalId: "hosp-pgh", firstName: "Arnel", lastName: "Suarez", position: "Pediatric Oncology Nurse", active: true },
  { id: "nurse-5", hospitalId: "hosp-pgh", firstName: "Feliza", lastName: "Ramos", position: "Medical Social Worker", active: true },
];
