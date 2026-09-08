"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollectionFamily, useCollection } from "@/lib/data/collection-store";
import { allowanceFromJson } from "@/lib/types/hr";
import type {
  Compensation,
  DaysFactor,
  EmploymentEvent,
  EmploymentEventKind,
  EmploymentStatus,
  EmploymentType,
  EmployeeDocument,
  DocumentStatus,
  PayBasis,
  SchedulePattern,
  SeparationCause,
  WorkSchedule,
} from "@/lib/types/hr";

/**
 * Per-employee families for the detail page (0036): employment history,
 * compensation history, schedules and the 201 checklist, each keyed by
 * employee id so opening one person's record never loads everyone's rates.
 * Reads only; writes go through app/(app)/hr/actions.ts.
 */

// --- Employment events -------------------------------------------------------

interface EmploymentEventRow {
  id: string;
  employee_id: string;
  kind: EmploymentEventKind;
  effective_on: string;
  employment_type: EmploymentType | null;
  status: EmploymentStatus | null;
  position: string | null;
  separation_cause: SeparationCause | null;
  reason: string | null;
  created_by: string | null;
  created_at: string;
}

function toEmploymentEvent(row: EmploymentEventRow): EmploymentEvent {
  return {
    id: row.id,
    employeeId: row.employee_id,
    kind: row.kind,
    effectiveOn: row.effective_on,
    employmentType: row.employment_type,
    status: row.status,
    position: row.position,
    separationCause: row.separation_cause,
    reason: row.reason,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export const employmentEventsFamily = createCollectionFamily<EmploymentEvent[]>({
  key: "hr.employment_events",
  empty: [],
  tables: () => [{ schema: "hr", table: "employment_events" }],
  fetch: async (employeeId) => {
    const { data, error } = await createClient()
      .schema("hr")
      .from("employment_events")
      .select("*")
      .eq("employee_id", employeeId)
      .order("effective_on", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as EmploymentEventRow[]).map(toEmploymentEvent);
  },
});

export function useEmploymentEvents(employeeId: string | null) {
  const { data: events, loading, error } = useCollection(employeeId ? employmentEventsFamily.get(employeeId) : null);
  return { events, loading, error };
}

// --- Compensation ------------------------------------------------------------

interface CompensationRow {
  id: string;
  employee_id: string;
  effective_from: string;
  effective_to: string | null;
  pay_basis: PayBasis;
  basic_monthly: number | string | null;
  daily_rate: number | string | null;
  days_factor: DaysFactor;
  hours_per_day: number | string;
  allowances: unknown[] | null;
  is_minimum_wage_earner: boolean;
  reason: string | null;
  created_by: string | null;
  created_at: string;
}

const num = (v: number | string | null) => (v === null ? null : Number(v));

export function toCompensation(row: CompensationRow): Compensation {
  return {
    id: row.id,
    employeeId: row.employee_id,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    payBasis: row.pay_basis,
    basicMonthly: num(row.basic_monthly),
    dailyRate: num(row.daily_rate),
    daysFactor: row.days_factor,
    hoursPerDay: Number(row.hours_per_day),
    allowances: (row.allowances ?? []).map(allowanceFromJson),
    isMinimumWageEarner: row.is_minimum_wage_earner,
    reason: row.reason,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export const compensationFamily = createCollectionFamily<Compensation[]>({
  key: "hr.compensation",
  empty: [],
  tables: () => [{ schema: "hr", table: "compensation" }],
  fetch: async (employeeId) => {
    const { data, error } = await createClient()
      .schema("hr")
      .from("compensation")
      .select("*")
      .eq("employee_id", employeeId)
      .order("effective_from", { ascending: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as CompensationRow[]).map(toCompensation);
  },
});

export function useCompensationHistory(employeeId: string | null) {
  const { data: history, loading, error } = useCollection(employeeId ? compensationFamily.get(employeeId) : null);
  return { history, current: history.find((c) => c.effectiveTo === null) ?? null, loading, error };
}

// --- Work schedules ----------------------------------------------------------

interface WorkScheduleRow {
  id: string;
  employee_id: string;
  effective_from: string;
  effective_to: string | null;
  pattern: SchedulePattern;
  break_minutes: number;
  hours_per_day: number | string;
  reason: string | null;
  created_at: string;
}

export function toWorkSchedule(row: WorkScheduleRow): WorkSchedule {
  return {
    id: row.id,
    employeeId: row.employee_id,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    pattern: row.pattern,
    breakMinutes: row.break_minutes,
    hoursPerDay: Number(row.hours_per_day),
    reason: row.reason,
    createdAt: row.created_at,
  };
}

export const workSchedulesFamily = createCollectionFamily<WorkSchedule[]>({
  key: "hr.work_schedules",
  empty: [],
  tables: () => [{ schema: "hr", table: "work_schedules" }],
  fetch: async (employeeId) => {
    const { data, error } = await createClient()
      .schema("hr")
      .from("work_schedules")
      .select("*")
      .eq("employee_id", employeeId)
      .order("effective_from", { ascending: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as WorkScheduleRow[]).map(toWorkSchedule);
  },
});

export function useWorkScheduleHistory(employeeId: string | null) {
  const { data: history, loading, error } = useCollection(employeeId ? workSchedulesFamily.get(employeeId) : null);
  return { history, current: history.find((s) => s.effectiveTo === null) ?? null, loading, error };
}

// --- 201 documents -----------------------------------------------------------

interface EmployeeDocumentRow {
  id: string;
  employee_id: string;
  document_type_id: string;
  status: DocumentStatus;
  drive_url: string | null;
  issued_on: string | null;
  expires_on: string | null;
  notes: string | null;
  updated_at: string;
}

function toEmployeeDocument(row: EmployeeDocumentRow): EmployeeDocument {
  return {
    id: row.id,
    employeeId: row.employee_id,
    documentTypeId: row.document_type_id,
    status: row.status,
    driveUrl: row.drive_url,
    issuedOn: row.issued_on,
    expiresOn: row.expires_on,
    notes: row.notes,
    updatedAt: row.updated_at,
  };
}

export const employeeDocumentsFamily = createCollectionFamily<EmployeeDocument[]>({
  key: "hr.employee_documents",
  empty: [],
  tables: () => [{ schema: "hr", table: "employee_documents" }],
  fetch: async (employeeId) => {
    const { data, error } = await createClient().schema("hr").from("employee_documents").select("*").eq("employee_id", employeeId);
    if (error) throw new Error(error.message);
    return ((data ?? []) as EmployeeDocumentRow[]).map(toEmployeeDocument);
  },
});

export function useEmployeeDocuments(employeeId: string | null) {
  const { data: documents, loading, error } = useCollection(employeeId ? employeeDocumentsFamily.get(employeeId) : null);
  return { documents, loading, error };
}
