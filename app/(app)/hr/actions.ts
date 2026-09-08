"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { parseRateTable } from "@/lib/utils/statutory";
import type {
  Allowance,
  DaysFactor,
  DocumentStatus,
  EmploymentEventKind,
  EmploymentStatus,
  EmploymentType,
  HolidayKind,
  PayBasis,
  RateTableKind,
  RateTableStatus,
  SchedulePattern,
  SeparationCause,
  Sex,
  Weekday,
} from "@/lib/types/hr";

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

/**
 * Every HR write goes through here, as the signed-in person: RLS's
 * "hr manage" policies (hr.is_hr_staff(), 0035) are the gate, and the
 * check below only buys a readable refusal instead of an RLS error. No
 * service-role client -- nothing an HR person can do here needs to bypass
 * a policy, so nothing does.
 */
type HrCaller = { error: string; supabase?: undefined } | { error?: undefined; supabase: Awaited<ReturnType<typeof createClient>>; userId: string };

async function hrCaller(): Promise<HrCaller> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const { data: staff } = await supabase.schema("shared").from("staff").select("role, is_hr, active").eq("id", user.id).single();
  if (!staff?.active || !(staff.role === "admin" || staff.is_hr)) {
    return { error: "Only admins and HR can do this." };
  }
  return { supabase, userId: user.id };
}

const text = (v: string | null | undefined) => {
  const t = v?.trim();
  return t ? t : null;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (v: unknown): v is string => typeof v === "string" && DATE_RE.test(v) && !Number.isNaN(Date.parse(v));
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function revalidateEmployee(id?: string) {
  revalidatePath("/hr");
  revalidatePath("/hr/employees");
  if (id) revalidatePath(`/hr/employees/${id}`);
}

// --- Employees -----------------------------------------------------------------

export interface EmployeeInput {
  employeeCode: string;
  firstName: string;
  middleName?: string | null;
  lastName: string;
  suffix?: string | null;
  position: string;
  department?: string | null;
  employmentType: EmploymentType;
  hireDate: string;
  birthdate?: string | null;
  sex?: Sex | null;
  civilStatus?: string | null;
  contactNumber?: string | null;
  email?: string | null;
  address?: string | null;
  emergencyContact?: { name?: string; relationship?: string; phone?: string; address?: string };
  notes?: string | null;
}

function employeeRow(input: EmployeeInput) {
  return {
    employee_code: input.employeeCode.trim().toUpperCase(),
    first_name: input.firstName.trim(),
    middle_name: text(input.middleName),
    last_name: input.lastName.trim(),
    suffix: text(input.suffix),
    position: input.position.trim(),
    department: text(input.department),
    employment_type: input.employmentType,
    hire_date: input.hireDate,
    birthdate: input.birthdate || null,
    sex: input.sex || null,
    civil_status: text(input.civilStatus),
    contact_number: text(input.contactNumber),
    email: text(input.email),
    address: text(input.address),
    emergency_contact: {
      name: text(input.emergencyContact?.name) ?? undefined,
      relationship: text(input.emergencyContact?.relationship) ?? undefined,
      phone: text(input.emergencyContact?.phone) ?? undefined,
      address: text(input.emergencyContact?.address) ?? undefined,
    },
    notes: text(input.notes),
  };
}

function validateEmployee(input: EmployeeInput): string | null {
  if (!input.employeeCode.trim()) return "Employee ID is required.";
  if (!input.firstName.trim() || !input.lastName.trim()) return "First and last name are required.";
  if (!input.position.trim()) return "Position is required.";
  if (!isDate(input.hireDate)) return "Date hired is required.";
  if (input.birthdate && !isDate(input.birthdate)) return "Birthdate is not a valid date.";
  return null;
}

/** Creates the 201 record and its opening "hired" event in one go. */
export async function createEmployee(input: EmployeeInput): Promise<ActionResult<{ id: string }>> {
  const problem = validateEmployee(input);
  if (problem) return { ok: false, error: problem };
  const caller = await hrCaller();
  if (caller.error !== undefined) return { ok: false, error: caller.error };

  const { data, error } = await caller.supabase
    .schema("hr")
    .from("employees")
    .insert({ ...employeeRow(input), created_by: caller.userId })
    .select("id")
    .single();
  if (error) {
    return { ok: false, error: /employees_employee_code_key/.test(error.message) ? `Employee ID ${input.employeeCode} is already in use.` : error.message };
  }

  const { error: eventError } = await caller.supabase.schema("hr").from("employment_events").insert({
    employee_id: data.id,
    kind: "hired",
    effective_on: input.hireDate,
    employment_type: input.employmentType,
    status: "active",
    position: input.position.trim(),
    created_by: caller.userId,
  });
  if (eventError) return { ok: false, error: eventError.message };

  revalidateEmployee(data.id);
  return { ok: true, data: { id: data.id } };
}

/** Profile fields only. Status, type, position and dates change through events. */
export async function updateEmployee(id: string, input: EmployeeInput): Promise<ActionResult> {
  const problem = validateEmployee(input);
  if (problem) return { ok: false, error: problem };
  const caller = await hrCaller();
  if (caller.error !== undefined) return { ok: false, error: caller.error };

  const row = employeeRow(input);
  const { error } = await caller.supabase
    .schema("hr")
    .from("employees")
    .update({
      employee_code: row.employee_code,
      first_name: row.first_name,
      middle_name: row.middle_name,
      last_name: row.last_name,
      suffix: row.suffix,
      department: row.department,
      birthdate: row.birthdate,
      sex: row.sex,
      civil_status: row.civil_status,
      contact_number: row.contact_number,
      email: row.email,
      address: row.address,
      emergency_contact: row.emergency_contact,
      notes: row.notes,
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateEmployee(id);
  return { ok: true };
}

/** Links (or unlinks) the login this 201 record belongs to. */
export async function linkStaffAccount(employeeId: string, staffId: string | null): Promise<ActionResult> {
  const caller = await hrCaller();
  if (caller.error !== undefined) return { ok: false, error: caller.error };
  const { error } = await caller.supabase.schema("hr").from("employees").update({ staff_id: staffId }).eq("id", employeeId);
  if (error) {
    return { ok: false, error: /employees_staff_id_key/.test(error.message) ? "That login is already linked to another employee." : error.message };
  }
  revalidateEmployee(employeeId);
  return { ok: true };
}

export interface EmployeePrivateInput {
  sssNo?: string | null;
  philhealthNo?: string | null;
  pagibigNo?: string | null;
  tin?: string | null;
  bankName?: string | null;
  bankAccountName?: string | null;
  bankAccountNo?: string | null;
}

/** Government IDs and bank details (hr.employee_private). Upsert: the row may not exist yet. */
export async function updateEmployeePrivate(employeeId: string, input: EmployeePrivateInput): Promise<ActionResult> {
  const caller = await hrCaller();
  if (caller.error !== undefined) return { ok: false, error: caller.error };
  const { error } = await caller.supabase.schema("hr").from("employee_private").upsert(
    {
      employee_id: employeeId,
      sss_no: text(input.sssNo),
      philhealth_no: text(input.philhealthNo),
      pagibig_no: text(input.pagibigNo),
      tin: text(input.tin),
      bank_name: text(input.bankName),
      bank_account_name: text(input.bankAccountName),
      bank_account_no: text(input.bankAccountNo),
      updated_by: caller.userId,
    },
    { onConflict: "employee_id" }
  );
  if (error) return { ok: false, error: error.message };
  revalidateEmployee(employeeId);
  return { ok: true };
}

// --- Employment events ---------------------------------------------------------

export interface EmploymentEventInput {
  kind: EmploymentEventKind;
  effectiveOn: string;
  employmentType?: EmploymentType | null;
  status?: EmploymentStatus | null;
  position?: string | null;
  separationCause?: SeparationCause | null;
  reason?: string | null;
}

export async function addEmploymentEvent(employeeId: string, input: EmploymentEventInput): Promise<ActionResult> {
  if (!isDate(input.effectiveOn)) return { ok: false, error: "Effective date is required." };
  if (input.kind === "separated" && !input.separationCause) return { ok: false, error: "A separation needs its cause — it decides separation pay." };
  if (input.kind === "regularized" && input.employmentType && input.employmentType !== "regular") {
    return { ok: false, error: "Regularisation makes the person a regular employee." };
  }
  const caller = await hrCaller();
  if (caller.error !== undefined) return { ok: false, error: caller.error };

  const { error } = await caller.supabase.schema("hr").from("employment_events").insert({
    employee_id: employeeId,
    kind: input.kind,
    effective_on: input.effectiveOn,
    employment_type: input.kind === "regularized" ? "regular" : input.employmentType || null,
    status: input.status || null,
    position: text(input.position),
    separation_cause: input.kind === "separated" ? input.separationCause : null,
    reason: text(input.reason),
    created_by: caller.userId,
  });
  if (error) return { ok: false, error: error.message };
  revalidateEmployee(employeeId);
  return { ok: true };
}

// --- Compensation --------------------------------------------------------------

export interface CompensationInput {
  effectiveFrom: string;
  payBasis: PayBasis;
  basicMonthly?: number | null;
  dailyRate?: number | null;
  daysFactor: DaysFactor;
  hoursPerDay: number;
  allowances: Allowance[];
  isMinimumWageEarner: boolean;
  reason?: string | null;
}

export async function addCompensation(employeeId: string, input: CompensationInput): Promise<ActionResult> {
  if (!isDate(input.effectiveFrom)) return { ok: false, error: "Effective date is required." };
  if (input.payBasis === "monthly" && !(Number(input.basicMonthly) > 0)) return { ok: false, error: "Monthly basic salary is required." };
  if (input.payBasis === "daily" && !(Number(input.dailyRate) > 0)) return { ok: false, error: "Daily rate is required." };
  if (![365, 313, 261].includes(input.daysFactor)) return { ok: false, error: "Days factor must be 365, 313 or 261." };
  if (!(input.hoursPerDay > 0 && input.hoursPerDay <= 12)) return { ok: false, error: "Hours per day must be between 1 and 12." };
  for (const a of input.allowances) {
    if (!a.label?.trim() || !(Number(a.amountMonthly) >= 0)) return { ok: false, error: "Each allowance needs a name and an amount." };
  }
  const caller = await hrCaller();
  if (caller.error !== undefined) return { ok: false, error: caller.error };

  const { error } = await caller.supabase.schema("hr").from("compensation").insert({
    employee_id: employeeId,
    effective_from: input.effectiveFrom,
    pay_basis: input.payBasis,
    basic_monthly: input.payBasis === "monthly" ? Number(input.basicMonthly) : null,
    daily_rate: input.payBasis === "daily" ? Number(input.dailyRate) : null,
    days_factor: input.daysFactor,
    hours_per_day: input.hoursPerDay,
    allowances: input.allowances.map((a) => ({
      code: a.code?.trim() || a.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_"),
      label: a.label.trim(),
      amount_monthly: Number(a.amountMonthly),
      tax: a.tax,
      de_minimis_kind: a.tax === "de_minimis" ? a.deMinimisKind || null : null,
    })),
    is_minimum_wage_earner: input.isMinimumWageEarner,
    reason: text(input.reason),
    created_by: caller.userId,
  });
  if (error) {
    if (/later compensation row/.test(error.message)) return { ok: false, error: "A later rate already starts after this date. New rates must start after the latest one." };
    if (/compensation_no_overlap/.test(error.message)) return { ok: false, error: "That date overlaps an existing rate." };
    return { ok: false, error: error.message };
  }
  revalidateEmployee(employeeId);
  return { ok: true };
}

// --- Work schedules ------------------------------------------------------------

export interface WorkScheduleInput {
  effectiveFrom: string;
  pattern: SchedulePattern;
  breakMinutes: number;
  hoursPerDay: number;
  reason?: string | null;
}

const WEEKDAYS: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export async function addWorkSchedule(employeeId: string, input: WorkScheduleInput): Promise<ActionResult> {
  if (!isDate(input.effectiveFrom)) return { ok: false, error: "Effective date is required." };
  let workdays = 0;
  for (const d of WEEKDAYS) {
    const shift = input.pattern[d];
    if (shift === null) continue;
    if (!shift || !TIME_RE.test(shift.start) || !TIME_RE.test(shift.end)) return { ok: false, error: `${d.toUpperCase()} needs a start and end time (HH:MM).` };
    if (shift.start === shift.end) return { ok: false, error: `${d.toUpperCase()} starts and ends at the same time.` };
    workdays++;
  }
  if (workdays === 0) return { ok: false, error: "At least one working day is needed." };
  if (workdays === 7) return { ok: false, error: "Every employee gets at least one rest day a week (Art. 91)." };
  if (!(input.breakMinutes >= 0 && input.breakMinutes <= 240)) return { ok: false, error: "Break must be between 0 and 240 minutes." };
  if (!(input.hoursPerDay > 0 && input.hoursPerDay <= 12)) return { ok: false, error: "Hours per day must be between 1 and 12." };
  const caller = await hrCaller();
  if (caller.error !== undefined) return { ok: false, error: caller.error };

  const pattern: SchedulePattern = { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null };
  for (const d of WEEKDAYS) pattern[d] = input.pattern[d] ? { start: input.pattern[d]!.start, end: input.pattern[d]!.end } : null;

  const { error } = await caller.supabase.schema("hr").from("work_schedules").insert({
    employee_id: employeeId,
    effective_from: input.effectiveFrom,
    pattern,
    break_minutes: input.breakMinutes,
    hours_per_day: input.hoursPerDay,
    reason: text(input.reason),
    created_by: caller.userId,
  });
  if (error) {
    if (/later work_schedules row/.test(error.message)) return { ok: false, error: "A later schedule already starts after this date." };
    return { ok: false, error: error.message };
  }
  revalidateEmployee(employeeId);
  return { ok: true };
}

// --- 201 documents -------------------------------------------------------------

export interface EmployeeDocumentInput {
  documentTypeId: string;
  status: DocumentStatus;
  driveUrl?: string | null;
  issuedOn?: string | null;
  expiresOn?: string | null;
  notes?: string | null;
}

export async function upsertEmployeeDocument(employeeId: string, input: EmployeeDocumentInput): Promise<ActionResult> {
  if (input.issuedOn && !isDate(input.issuedOn)) return { ok: false, error: "Issued date is not valid." };
  if (input.expiresOn && !isDate(input.expiresOn)) return { ok: false, error: "Expiry date is not valid." };
  const url = text(input.driveUrl);
  if (url && !/^https?:\/\//i.test(url)) return { ok: false, error: "The link should start with http:// or https://." };
  const caller = await hrCaller();
  if (caller.error !== undefined) return { ok: false, error: caller.error };

  const { error } = await caller.supabase.schema("hr").from("employee_documents").upsert(
    {
      employee_id: employeeId,
      document_type_id: input.documentTypeId,
      status: input.status,
      drive_url: url,
      issued_on: input.issuedOn || null,
      expires_on: input.expiresOn || null,
      notes: text(input.notes),
      updated_by: caller.userId,
    },
    { onConflict: "employee_id,document_type_id" }
  );
  if (error) return { ok: false, error: error.message };
  revalidateEmployee(employeeId);
  return { ok: true };
}

// --- Reference data (0037) -----------------------------------------------------

export interface HolidayInput {
  date: string;
  name: string;
  kind: HolidayKind;
  scopeCity?: string | null;
  source?: string | null;
}

export async function saveHoliday(id: string | null, input: HolidayInput): Promise<ActionResult> {
  if (!isDate(input.date)) return { ok: false, error: "Date is required." };
  if (!input.name.trim()) return { ok: false, error: "Name is required." };
  const caller = await hrCaller();
  if (caller.error !== undefined) return { ok: false, error: caller.error };
  const row = { date: input.date, name: input.name.trim(), kind: input.kind, scope_city: text(input.scopeCity), source: text(input.source) };
  const q = caller.supabase.schema("hr").from("holidays");
  const { error } = id ? await q.update(row).eq("id", id) : await q.insert({ ...row, created_by: caller.userId });
  if (error) return { ok: false, error: /holidays_date_name_key/.test(error.message) ? "That holiday is already listed on that date." : error.message };
  revalidatePath("/hr/settings");
  return { ok: true };
}

export async function deleteHoliday(id: string): Promise<ActionResult> {
  const caller = await hrCaller();
  if (caller.error !== undefined) return { ok: false, error: caller.error };
  const { error } = await caller.supabase.schema("hr").from("holidays").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/hr/settings");
  return { ok: true };
}

export interface RateTableInput {
  kind: RateTableKind;
  effectiveFrom: string;
  effectiveTo?: string | null;
  status: RateTableStatus;
  source: string;
  params: Record<string, unknown>;
  rows: unknown[];
  notes?: string | null;
}

/**
 * A new version of a government table, or an edit to one. The shape is
 * validated by the same parser the payroll engine trusts, so a bracket typo
 * is refused here rather than mispricing a payslip.
 */
export async function saveRateTable(id: string | null, input: RateTableInput): Promise<ActionResult> {
  if (!isDate(input.effectiveFrom)) return { ok: false, error: "Effective date is required." };
  if (input.effectiveTo && !isDate(input.effectiveTo)) return { ok: false, error: "End date is not valid." };
  if (!input.source.trim()) return { ok: false, error: "Say which circular, order or regulation this is." };
  try {
    parseRateTable({ kind: input.kind, params: input.params, rows: input.rows, effectiveFrom: input.effectiveFrom, status: input.status });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Invalid table." };
  }
  const caller = await hrCaller();
  if (caller.error !== undefined) return { ok: false, error: caller.error };
  const row = {
    kind: input.kind,
    effective_from: input.effectiveFrom,
    effective_to: input.effectiveTo || null,
    status: input.status,
    source: input.source.trim(),
    params: input.params,
    rows: input.rows,
    notes: text(input.notes),
  };
  const q = caller.supabase.schema("hr").from("rate_tables");
  const { error } = id ? await q.update(row).eq("id", id) : await q.insert({ ...row, created_by: caller.userId });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/hr/settings");
  return { ok: true };
}

export async function updateLeaveType(id: string, input: { name: string; active: boolean; daysDefault: number | null; requiresDocument: boolean }): Promise<ActionResult> {
  if (!input.name.trim()) return { ok: false, error: "Name is required." };
  const caller = await hrCaller();
  if (caller.error !== undefined) return { ok: false, error: caller.error };
  const { error } = await caller.supabase
    .schema("hr")
    .from("leave_types")
    .update({ name: input.name.trim(), active: input.active, days_default: input.daysDefault, requires_document: input.requiresDocument })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/hr/settings");
  return { ok: true };
}

export async function updateDocumentType(id: string, input: { name: string; required: boolean; validityMonths: number | null; active: boolean; notes?: string | null }): Promise<ActionResult> {
  if (!input.name.trim()) return { ok: false, error: "Name is required." };
  const caller = await hrCaller();
  if (caller.error !== undefined) return { ok: false, error: caller.error };
  const { error } = await caller.supabase
    .schema("hr")
    .from("document_types")
    .update({ name: input.name.trim(), required: input.required, validity_months: input.validityMonths, active: input.active, notes: text(input.notes) })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/hr/settings");
  return { ok: true };
}

// --- Roster overrides (0039) -----------------------------------------------------

export interface ScheduleOverrideInput {
  employeeId: string;
  date: string;
  /** null with isRestDay = true is a rest day. */
  start: string | null;
  end: string | null;
  isRestDay: boolean;
  reason?: string | null;
}

/** One day's departure from the weekly pattern: a swapped rest day, a 24-hour duty, a night shift. Upsert on (employee, date). */
export async function saveScheduleOverride(input: ScheduleOverrideInput): Promise<ActionResult> {
  if (!isDate(input.date)) return { ok: false, error: "Date is required." };
  if (!input.isRestDay) {
    if (!input.start || !input.end || !TIME_RE.test(input.start) || !TIME_RE.test(input.end)) return { ok: false, error: "Start and end times (HH:MM) are required for a working day." };
    if (input.start === input.end) return { ok: false, error: "Start and end are the same time." };
  }
  const caller = await hrCaller();
  if (caller.error !== undefined) return { ok: false, error: caller.error };
  const { error } = await caller.supabase.schema("hr").from("schedule_overrides").upsert(
    {
      employee_id: input.employeeId,
      date: input.date,
      start_time: input.isRestDay ? null : input.start,
      end_time: input.isRestDay ? null : input.end,
      is_rest_day: input.isRestDay,
      reason: text(input.reason),
      created_by: caller.userId,
    },
    { onConflict: "employee_id,date" }
  );
  if (error) return { ok: false, error: error.message };
  revalidatePath("/staff/roster");
  return { ok: true };
}

export async function deleteScheduleOverride(id: string): Promise<ActionResult> {
  const caller = await hrCaller();
  if (caller.error !== undefined) return { ok: false, error: caller.error };
  const { error } = await caller.supabase.schema("hr").from("schedule_overrides").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/staff/roster");
  return { ok: true };
}
