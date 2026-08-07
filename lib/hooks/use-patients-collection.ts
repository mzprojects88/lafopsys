"use client";

import { useLocalCollection } from "@/lib/store/use-mock-store";
import {
  patients as seedPatients,
  carers as seedCarers,
  stays as seedStays,
  appointments as seedAppointments,
} from "@/lib/mock-data/patients";
import type { Patient, Carer, Stay, Appointment } from "@/lib/types/patient";

/**
 * Live (localStorage-backed) patients/carers/stays/appointments, keyed to
 * match the seed exports in lib/mock-data/patients.ts. Anything that must
 * reflect a new admission (e.g. from the "Confirm Arrival & Admit" flow) or a
 * doctor-logged visit (from the partner portal) should read through this hook
 * instead of importing the static seed arrays directly.
 */
export function usePatientsData() {
  const patients = useLocalCollection<Patient>("patients", seedPatients);
  const carers = useLocalCollection<Carer>("carers", seedCarers);
  const stays = useLocalCollection<Stay>("stays", seedStays);
  const appointments = useLocalCollection<Appointment>("appointments", seedAppointments);

  return {
    patients: patients.items,
    carers: carers.items,
    stays: stays.items,
    appointments: appointments.items,
    addPatient: patients.addItem,
    addCarer: carers.addItem,
    addStay: stays.addItem,
    addAppointment: appointments.addItem,
    updatePatient: patients.updateItem,
    updateStay: stays.updateItem,
  };
}
