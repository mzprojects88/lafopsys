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

  // DSWD Caseload Inventory report fields — sourced from Patient Database_NCH.xlsx's
  // "Copy of For DSWD Caseload Inven" sheet, joined onto the patient master by
  // normalized name (see scripts/clean-dswd-data.py). Undefined where no DSWD-sheet
  // row matched this patient, not fabricated.
  religion?: string;
  sectorCaseCategory?: string;
  placeOfBirth?: string;
  /** Broad illness category (e.g. "Cancer") — distinct from `diagnosisIds`, which is the specific diagnosis. */
  illnessType?: string;
  sourceOfReferralText?: string;
  reasonForReferral?: string;
  socialProfileOfParent?: string;
  servicesReceived?: string;
  /** Free text, e.g. date/cause — only present for deceased patients. */
  deathInfo?: string;
  /** Raw source text (e.g. "6 months") — not normalized to a day count, source format varies. */
  lengthOfStay?: string;
}

export interface Carer {
  id: string;
  patientId: string;
  name: string;
  /** Missing for 1 of 169 real records (no relationship recorded in the source) -- don't fabricate one. */
  relationship?: string;
  /** Missing for 2 of 169 real records -- don't fabricate one. */
  mobileNumber?: string;
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
  /** Free-text note on the patient's next hospital appointment, transcribed from the hospital's referral sheet. */
  nextAppointmentNote?: string;
  /** Free-text note on where/how this referral was transcribed from (e.g. hospital sheet date/source). */
  transcriptionNote?: string;
  /** Staff member who transcribed/submitted this referral. */
  submittedByStaffId?: string;
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
