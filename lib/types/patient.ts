export type PatientStatus =
  | "ongoing"
  | "check_up"
  | "completed"
  | "expired"
  | "lost_to_follow_up"
  | "non_pedia";

export interface Patient {
  id: string;
  /** The LFCN case number (0057); a record from before it may show the sheet's CN until the sync numbers it. */
  patientNumber: string;
  /** The Patients Database sheet's CN; missing until the sheet lists the child. */
  sheetCn?: string;
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

  // From the Patients Database sheet and its intake form (0057), kept by the sync.
  /** Sheet column I: C, T, B, H, O or FD (lib/utils/master-sheet.ts ILLNESS_CODES). */
  illnessCode?: "C" | "T" | "B" | "H" | "O" | "FD";
  /** Sheet column P: A chemo, B blood transfusion, C post procedure, D follow-up. */
  priority?: "A" | "B" | "C" | "D";
  /** The sheet's old CODE, e.g. LAF-2024-001-C. */
  legacyCode?: string;
  distanceKm?: number;
  mssName?: string;
  attendingPhysician?: string;
  parentEducation?: string;
  parentOccupation?: string;
  householdIncome?: string;
  parentEmployment?: string;
  housingType?: string;
  /** When the intake form's "I authorize" was submitted. */
  consentAuthorizedAt?: string;
  intakeLinks?: { photo?: string; parentId?: string; medicalCertificate?: string };
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
  /** The hospital that referred this patient. */
  hospitalId?: string;
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

/** How the family reached LAF House (0052). */
export type ArrivalMode = "laf_hope" | "ride_app" | "own_transport" | "hospital_vehicle";
export type ArrivalApp = "grab" | "joyride" | "indrive" | "moveit" | "angkas";

/** One ride-app booking that brought one or more families (ops.v_arrival_rides). */
export interface ArrivalRide {
  id: string;
  rideDate: string;
  app: ArrivalApp;
  fare: number | null;
  notes?: string;
  reimbursedAt?: string;
  reimbursedAmount?: number;
  reimbursedTo?: string;
  reimbursedBy?: string;
  riders: number;
  /** 2+ riders and not Angkas -- the database's rule. */
  reimbursable: boolean;
}

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
  arrivalMode?: ArrivalMode;
  arrivalRideId?: string;
  arrivalTripId?: string;
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

export type PatientDocumentType =
  | "parent_guardian_id"
  | "medical_certificate"
  | "signed_intake_form"
  | "patient_photo"
  | "photo_media_consent";

export interface PatientDocument {
  id: string;
  patientId: string;
  documentType: PatientDocumentType;
  /** Path within the `patient-documents` Storage bucket. Undefined until a file is actually uploaded. */
  storagePath?: string;
  collectedAt?: string;
  collectedByStaffId?: string;
  notes?: string;
}

/** Org-editable orientation-topic list. Deliberately starts empty -- real arrival-day
 * script content is unknown org policy and must never be fabricated; staff add the
 * real topics themselves as they define them. */
export interface OrientationTopic {
  id: string;
  topic: string;
  /** The same rule in English, beside the house's own Filipino text (0056). */
  topicEn?: string;
  sortOrder: number;
  /** Covered again with a returning family: the shorter list for a second stay (0054). */
  returneeToo: boolean;
}

/** One topic ticked on one stay -- a family is oriented at every admission (0054). */
export interface StayOrientationCheck {
  stayId: string;
  topicId: string;
  coveredAt: string;
  coveredByStaffId?: string;
}
