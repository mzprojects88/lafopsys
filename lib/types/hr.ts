/**
 * HR domain types (schema `hr`, migrations 0035+).
 *
 * Everything here is the camel-cased twin of a table; the hooks in
 * lib/hooks/use-*-collection.ts map rows to these and the server actions in
 * app/(app)/hr actions map back. Private identifiers (EmployeePrivate)
 * never travel through a collection store -- see 0036.
 */

export type EmploymentType = "probationary" | "regular" | "contractual" | "part_time" | "casual";
export type EmploymentStatus = "active" | "on_leave" | "resigned" | "terminated";
export type Sex = "female" | "male";

export const EMPLOYMENT_TYPES: { value: EmploymentType; label: string }[] = [
  { value: "probationary", label: "Probationary" },
  { value: "regular", label: "Regular" },
  { value: "contractual", label: "Contractual" },
  { value: "part_time", label: "Part-time" },
  { value: "casual", label: "Casual" },
];

export const EMPLOYMENT_STATUSES: { value: EmploymentStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "on_leave", label: "On leave" },
  { value: "resigned", label: "Resigned" },
  { value: "terminated", label: "Terminated" },
];

export interface EmergencyContact {
  name?: string;
  relationship?: string;
  phone?: string;
  address?: string;
}

export interface Employee {
  id: string;
  employeeCode: string;
  /** shared.staff.id when this person has a login; null until HR links one. */
  staffId: string | null;
  firstName: string;
  middleName: string | null;
  lastName: string;
  suffix: string | null;
  position: string;
  department: string | null;
  employmentType: EmploymentType;
  status: EmploymentStatus;
  hireDate: string;
  regularizationDate: string | null;
  separationDate: string | null;
  birthdate: string | null;
  sex: Sex | null;
  civilStatus: string | null;
  contactNumber: string | null;
  email: string | null;
  address: string | null;
  emergencyContact: EmergencyContact;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export function employeeFullName(e: Pick<Employee, "firstName" | "lastName" | "suffix">) {
  return [e.firstName, e.lastName, e.suffix].filter(Boolean).join(" ");
}

/** RA 10173 sensitive personal information. Fetched per person, on demand. */
export interface EmployeePrivate {
  employeeId: string;
  sssNo: string | null;
  philhealthNo: string | null;
  pagibigNo: string | null;
  tin: string | null;
  bankName: string | null;
  bankAccountName: string | null;
  bankAccountNo: string | null;
  updatedAt: string;
}

export type EmploymentEventKind = "hired" | "regularized" | "status_change" | "position_change" | "separated" | "rehired";
export type SeparationCause =
  | "resignation"
  | "end_of_contract"
  | "redundancy"
  | "retrenchment"
  | "closure"
  | "disease"
  | "just_cause"
  | "retirement"
  | "death";

export const SEPARATION_CAUSES: { value: SeparationCause; label: string; hint: string }[] = [
  { value: "resignation", label: "Resignation", hint: "No separation pay (Art. 300)" },
  { value: "end_of_contract", label: "End of contract", hint: "No separation pay" },
  { value: "redundancy", label: "Redundancy", hint: "1 month per year of service (Art. 298)" },
  { value: "retrenchment", label: "Retrenchment", hint: "½ month per year of service (Art. 298)" },
  { value: "closure", label: "Closure", hint: "½ month per year of service (Art. 298)" },
  { value: "disease", label: "Disease", hint: "½ month per year of service (Art. 299)" },
  { value: "just_cause", label: "Just cause", hint: "No separation pay (Art. 297)" },
  { value: "retirement", label: "Retirement", hint: "Retirement pay under RA 7641" },
  { value: "death", label: "Death", hint: "Final pay to the heirs" },
];

export interface EmploymentEvent {
  id: string;
  employeeId: string;
  kind: EmploymentEventKind;
  effectiveOn: string;
  employmentType: EmploymentType | null;
  status: EmploymentStatus | null;
  position: string | null;
  separationCause: SeparationCause | null;
  reason: string | null;
  createdBy: string | null;
  createdAt: string;
}

export type PayBasis = "monthly" | "daily";
export type DaysFactor = 365 | 313 | 261;
export type AllowanceTax = "taxable" | "de_minimis";

export interface Allowance {
  code: string;
  label: string;
  amountMonthly: number;
  tax: AllowanceTax;
  /** Which RR 11-2018 de minimis limit applies (rice, laundry, ...). */
  deMinimisKind?: string;
}

export interface Compensation {
  id: string;
  employeeId: string;
  effectiveFrom: string;
  /** Exclusive; null while current. */
  effectiveTo: string | null;
  payBasis: PayBasis;
  basicMonthly: number | null;
  dailyRate: number | null;
  daysFactor: DaysFactor;
  hoursPerDay: number;
  allowances: Allowance[];
  isMinimumWageEarner: boolean;
  reason: string | null;
  createdBy: string | null;
  createdAt: string;
}

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export const WEEKDAYS: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export interface ShiftTimes {
  /** `HH:MM`, 24-hour. `end` earlier than `start` is an overnight shift. */
  start: string;
  end: string;
}

/** A null day is a rest day (Art. 91). */
export type SchedulePattern = Record<Weekday, ShiftTimes | null>;

export interface WorkSchedule {
  id: string;
  employeeId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  pattern: SchedulePattern;
  breakMinutes: number;
  hoursPerDay: number;
  reason: string | null;
  createdAt: string;
}

export type DocumentCategory = "identity" | "government" | "employment" | "clearance" | "record";
export type DocumentStatus = "complete" | "missing" | "expired" | "not_applicable" | "for_renewal" | "submitted" | "pending";

export const DOCUMENT_STATUSES: { value: DocumentStatus; label: string }[] = [
  { value: "complete", label: "Complete" },
  { value: "submitted", label: "Submitted" },
  { value: "pending", label: "Pending" },
  { value: "for_renewal", label: "For renewal" },
  { value: "expired", label: "Expired" },
  { value: "missing", label: "Missing" },
  { value: "not_applicable", label: "Not applicable" },
];

export interface DocumentType {
  id: string;
  name: string;
  category: DocumentCategory;
  required: boolean;
  validityMonths: number | null;
  notes: string | null;
  sort: number;
  active: boolean;
}

export interface EmployeeDocument {
  id: string;
  employeeId: string;
  documentTypeId: string;
  status: DocumentStatus;
  driveUrl: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  notes: string | null;
  updatedAt: string;
}

// --- Reference tables (0037) -------------------------------------------------

export type HolidayKind = "regular" | "special_non_working" | "special_working";

export const HOLIDAY_KINDS: { value: HolidayKind; label: string; hint: string }[] = [
  { value: "regular", label: "Regular holiday", hint: "Paid even if unworked; 200% when worked (Art. 94)" },
  { value: "special_non_working", label: "Special non-working", hint: "No work, no pay; 130% when worked" },
  { value: "special_working", label: "Special working", hint: "An ordinary working day" },
];

export interface Holiday {
  id: string;
  date: string;
  name: string;
  kind: HolidayKind;
  /** null = nationwide; otherwise a city/province the holiday is local to. */
  scopeCity: string | null;
  source: string | null;
}

export type RateTableKind =
  | "sss"
  | "philhealth"
  | "pagibig"
  | "tax_semi_monthly"
  | "tax_monthly"
  | "tax_annual"
  | "minimum_wage";
export type RateTableStatus = "draft" | "in_force" | "enjoined" | "superseded";

export const RATE_TABLE_KINDS: { value: RateTableKind; label: string }[] = [
  { value: "sss", label: "SSS contributions" },
  { value: "philhealth", label: "PhilHealth premium" },
  { value: "pagibig", label: "Pag-IBIG contributions" },
  { value: "tax_semi_monthly", label: "Withholding tax (semi-monthly)" },
  { value: "tax_monthly", label: "Withholding tax (monthly)" },
  { value: "tax_annual", label: "Income tax (annual)" },
  { value: "minimum_wage", label: "Minimum wage" },
];

export interface RateTable {
  id: string;
  kind: RateTableKind;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: RateTableStatus;
  source: string;
  params: Record<string, unknown>;
  rows: unknown[];
  notes: string | null;
  updatedAt: string;
}

export type LeaveEntitlementSource = "settings_vl" | "settings_sl" | "fixed";

export interface LeaveEligibility {
  minServiceMonths?: number;
  sex?: Sex;
  civilStatus?: string;
  maxOccurrences?: number;
  perEvent?: boolean;
}

export interface LeaveType {
  id: string;
  name: string;
  statutory: boolean;
  paid: boolean;
  entitlementSource: LeaveEntitlementSource;
  daysDefault: number | null;
  eligibility: LeaveEligibility;
  requiresDocument: boolean;
  lawRef: string | null;
  active: boolean;
  sort: number;
}

// --- Pay periods, timesheets, roster (0039) ---------------------------------

export type PayPeriodStatus = "open" | "timesheets_approved" | "computed" | "approved" | "paid" | "closed";

export const PAY_PERIOD_STATUSES: { value: PayPeriodStatus; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "timesheets_approved", label: "Timesheets approved" },
  { value: "computed", label: "Computed" },
  { value: "approved", label: "Approved" },
  { value: "paid", label: "Paid" },
  { value: "closed", label: "Closed" },
];

export interface PayPeriod {
  id: string;
  year: number;
  /** 1-24: odd = 1st-15th, even = 16th-end. */
  seq: number;
  startsOn: string;
  endsOn: string;
  payDate: string;
  status: PayPeriodStatus;
  notes: string | null;
  updatedAt: string;
}

export type PeriodTimesheetStatus = "draft" | "approved" | "reopened";

export interface PeriodTimesheet {
  id: string;
  periodId: string;
  employeeId: string;
  status: PeriodTimesheetStatus;
  /** lib/utils/attendance.ts PeriodAttendance, frozen at approval; null until computed. */
  summary: import("@/lib/utils/attendance").PeriodAttendance | null;
  approvedBy: string | null;
  approvedAt: string | null;
  notes: string | null;
  updatedAt: string;
}

/** One day's departure from the weekly pattern (a swapped rest day, a 24-hour duty). */
export interface ScheduleOverride {
  id: string;
  employeeId: string;
  date: string;
  /** `HH:MM`; null on a rest day. */
  start: string | null;
  end: string | null;
  isRestDay: boolean;
  reason: string | null;
}

// --- Leave (0040) --------------------------------------------------------------

export type LeaveRequestStatus = "pending" | "approved" | "rejected" | "cancelled";

export const LEAVE_REQUEST_STATUSES: { value: LeaveRequestStatus; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "cancelled", label: "Cancelled" },
];

export interface LeaveRequest {
  id: string;
  employeeId: string;
  leaveTypeId: string;
  startsOn: string;
  endsOn: string;
  startHalf: boolean;
  endHalf: boolean;
  /** Scheduled workdays covered, computed at submission. */
  days: number;
  reason: string | null;
  documentUrl: string | null;
  status: LeaveRequestStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
}

export type LeaveAdjustmentKind = "opening" | "carry_in" | "conversion" | "forfeit" | "manual";

export interface LeaveAdjustment {
  id: string;
  employeeId: string;
  leaveTypeId: string;
  year: number;
  kind: LeaveAdjustmentKind;
  days: number;
  note: string | null;
  createdAt: string;
}
