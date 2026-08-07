export type PatientStatus =
  | "ongoing"
  | "check_up"
  | "completed"
  | "expired"
  | "lost_to_follow_up"
  | "non_pedia";

export interface Patient {
  id: string;
  patientNumber: string;
  firstName: string;
  lastName: string;
  /** Missing for a small number of real records with corrupted source data -- don't fabricate one. */
  birthDate?: string;
  sex: "M" | "F";
  provinceId: string;
  cityId?: string;
  /** Literal address text, used when the address can't be resolved to a curated `City`. */
  rawAddress?: string;
  diagnosisIds: string[];
  treatmentPhaseId: string;
  status: PatientStatus;
  /** Undefined means unknown, not "no" -- don't default it. */
  isolationRequired?: boolean;
  /** Undefined means unknown, not "not granted" -- don't default it. */
  photoConsentGranted?: boolean;
  carerIds: string[];
  admittedAt: string;
  maritalStatus?: string;
  remarks?: string;
  /** Hospital that referred this patient — set for both real historical data and portal-admitted referrals. */
  referringHospitalId?: string;
}

export interface Carer {
  id: string;
  patientId: string;
  name: string;
  relationship: string;
  mobileNumber: string;
  effectiveFrom: string;
  effectiveTo?: string;
}

export type ReferralStatus = "submitted" | "approved" | "waitlisted" | "declined" | "admitted";

export interface Referral {
  id: string;
  patientName: string;
  referringPerson: string;
  department: string;
  urgency: "routine" | "urgent" | "emergency";
  date: string;
  status: ReferralStatus;
  reason?: string;
  /** Set when submitted through the partner hospital portal (app/partners) rather than created internally. */
  hospitalId?: string;
  submittedByNurseId?: string;
  patientFirstName?: string;
  patientLastName?: string;
  patientBirthDate?: string;
  patientSex?: "M" | "F";
  diagnosisIds?: string[];
  treatmentPhaseId?: string;
  provinceId?: string;
  rawAddress?: string;
  carerName?: string;
  carerRelationship?: string;
  carerMobile?: string;
  /** Set by the "Confirm Arrival & Admit" action once the family physically arrives at LAF House. */
  admittedPatientId?: string;
  admittedAt?: string;
}

export type StayStatus = "in_house" | "checked_out" | "overdue";

export interface Stay {
  id: string;
  patientId: string;
  bedPositionId: string;
  carerId?: string;
  checkInAt: string;
  expectedCheckoutAt?: string;
  checkOutAt?: string;
  checkOutReason?: string;
  destination?: string;
  followUpDate?: string;
  status: StayStatus;
}

export interface Appointment {
  id: string;
  patientId: string;
  date: string;
  time: string;
  clinic: string;
  purpose: string;
  needsTransport: boolean;
}
