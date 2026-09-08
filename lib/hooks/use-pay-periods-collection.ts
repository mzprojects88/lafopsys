"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, createCollectionFamily, useCollection } from "@/lib/data/collection-store";
import type { PayPeriod, PayPeriodStatus, PeriodTimesheet, PeriodTimesheetStatus, ScheduleOverride } from "@/lib/types/hr";
import type { PeriodAttendance } from "@/lib/utils/attendance";

// --- Pay periods -------------------------------------------------------------

interface PayPeriodRow {
  id: string;
  year: number;
  seq: number;
  starts_on: string;
  ends_on: string;
  pay_date: string;
  status: PayPeriodStatus;
  notes: string | null;
  updated_at: string;
}

export function toPayPeriod(row: PayPeriodRow): PayPeriod {
  return {
    id: row.id,
    year: row.year,
    seq: row.seq,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    payDate: row.pay_date,
    status: row.status,
    notes: row.notes,
    updatedAt: row.updated_at,
  };
}

/** The semi-monthly calendar (hr.pay_periods, 0039), newest first. */
export const payPeriodsStore = createCollection<PayPeriod[]>({
  key: "hr.pay_periods",
  empty: [],
  tables: [{ schema: "hr", table: "pay_periods" }],
  fetch: async () => {
    const { data, error } = await createClient().schema("hr").from("pay_periods").select("*").order("starts_on", { ascending: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as PayPeriodRow[]).map(toPayPeriod);
  },
});

export function usePayPeriods() {
  const { data: periods, loading, error } = useCollection(payPeriodsStore);
  return { periods, loading, error };
}

// --- Period timesheets -------------------------------------------------------

interface PeriodTimesheetRow {
  id: string;
  period_id: string;
  employee_id: string;
  status: PeriodTimesheetStatus;
  summary: PeriodAttendance | Record<string, never>;
  approved_by: string | null;
  approved_at: string | null;
  notes: string | null;
  updated_at: string;
}

export function toPeriodTimesheet(row: PeriodTimesheetRow): PeriodTimesheet {
  return {
    id: row.id,
    periodId: row.period_id,
    employeeId: row.employee_id,
    status: row.status,
    summary: row.summary && "days" in row.summary ? (row.summary as PeriodAttendance) : null,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    notes: row.notes,
    updatedAt: row.updated_at,
  };
}

/** Per period: the approval row of every employee (HR) or the caller's own. */
export const periodTimesheetsFamily = createCollectionFamily<PeriodTimesheet[]>({
  key: "hr.period_timesheets",
  empty: [],
  tables: () => [{ schema: "hr", table: "period_timesheets" }],
  fetch: async (periodId) => {
    const { data, error } = await createClient().schema("hr").from("period_timesheets").select("*").eq("period_id", periodId);
    if (error) throw new Error(error.message);
    return ((data ?? []) as PeriodTimesheetRow[]).map(toPeriodTimesheet);
  },
});

export function usePeriodTimesheets(periodId: string | null) {
  const { data: timesheets, loading, error } = useCollection(periodId ? periodTimesheetsFamily.get(periodId) : null);
  return { timesheets, loading, error };
}

// --- Schedule overrides ------------------------------------------------------

interface ScheduleOverrideRow {
  id: string;
  employee_id: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  is_rest_day: boolean;
  reason: string | null;
}

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : null);

export function toScheduleOverride(row: ScheduleOverrideRow): ScheduleOverride {
  return {
    id: row.id,
    employeeId: row.employee_id,
    date: row.date,
    start: hhmm(row.start_time),
    end: hhmm(row.end_time),
    isRestDay: row.is_rest_day,
    reason: row.reason,
  };
}

/** Every override, all employees: small (a few rows a week) and read by the roster for everyone. */
export const scheduleOverridesStore = createCollection<ScheduleOverride[]>({
  key: "hr.schedule_overrides",
  empty: [],
  tables: [{ schema: "hr", table: "schedule_overrides" }],
  fetch: async () => {
    const { data, error } = await createClient().schema("hr").from("schedule_overrides").select("*").order("date");
    if (error) throw new Error(error.message);
    return ((data ?? []) as ScheduleOverrideRow[]).map(toScheduleOverride);
  },
});

export function useScheduleOverrides() {
  const { data: overrides, loading, error } = useCollection(scheduleOverridesStore);
  return { overrides, loading, error };
}
