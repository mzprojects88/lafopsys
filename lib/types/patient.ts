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
  birthDate: string;
  sex: "M" | "F";
  provinceId: string;
  cityId: string;
  diagnosisIds: string[];
  treatmentPhaseId: string;
  status: PatientStatus;
  isolationRequired: boolean;
  photoConsentGranted: boolean;
  carerIds: string[];
  admittedAt: string;
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

export type ReferralStatus = "submitted" | "approved" | "waitlisted" | "declined";

export interface Referral {
  id: string;
  patientName: string;
  referringPerson: string;
  department: string;
  urgency: "routine" | "urgent" | "emergency";
  date: string;
  status: ReferralStatus;
  reason?: string;
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
