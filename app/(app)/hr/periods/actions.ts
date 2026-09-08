"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { payDateFor, semiMonthlyPeriods, type HolidayLike, type PayDateRule } from "@/lib/utils/pay-period";
import { periodAttendance, type PeriodAttendance } from "@/lib/utils/attendance";
import { addDays, pairSessions } from "@/lib/utils/dtr";
import type { ActionResult } from "../actions";

/** Same shape as app/(app)/hr/actions.ts hrCaller: RLS is the gate, this is the readable refusal. */
async function hrCaller() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." as string, supabase: undefined, userId: undefined };
  const { data: staff } = await supabase.schema("shared").from("staff").select("role, is_hr, active").eq("id", user.id).single();
  if (!staff?.active || !(staff.role === "admin" || staff.is_hr)) return { error: "Only admins and HR can do this." as string, supabase: undefined, userId: undefined };
  return { error: undefined, supabase, userId: user.id };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Creates the year's 24 semi-monthly periods with pay dates from the rule
 * in Settings, skipping any that already exist (their pay dates may have
 * been edited by hand and are left alone).
 */
export async function generatePayPeriods(year: number): Promise<ActionResult<{ created: number }>> {
  if (!Number.isInteger(year) || year < 2020 || year > 2100) return { ok: false, error: "Year out of range." };
  const caller = await hrCaller();
  if (caller.error !== undefined) return { ok: false, error: caller.error };
  const { supabase, userId } = caller;

  const [{ data: settings }, { data: holidays }, { data: existing }] = await Promise.all([
    supabase.schema("shared").from("app_settings").select("payroll_pay_date_rule").maybeSingle(),
    supabase.schema("hr").from("holidays").select("date, kind"),
    supabase.schema("hr").from("pay_periods").select("seq").eq("year", year),
  ]);
  const rule = (settings?.payroll_pay_date_rule as PayDateRule | null) ?? { kind: "offset", days: 5 };
  const have = new Set((existing ?? []).map((r) => r.seq as number));
  const rows = semiMonthlyPeriods(year)
    .filter((p) => !have.has(p.seq))
    .map((p) => ({
      year: p.year,
      seq: p.seq,
      starts_on: p.from,
      ends_on: p.to,
      pay_date: payDateFor(p, rule, (holidays ?? []) as HolidayLike[]),
      created_by: userId,
    }));
  if (rows.length === 0) return { ok: true, data: { created: 0 } };
  const { error } = await supabase.schema("hr").from("pay_periods").insert(rows);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/hr/periods");
  return { ok: true, data: { created: rows.length } };
}

export async function updatePayPeriod(id: string, input: { payDate: string; notes?: string | null }): Promise<ActionResult> {
  if (!DATE_RE.test(input.payDate)) return { ok: false, error: "Pay date is required." };
  const caller = await hrCaller();
  if (caller.error !== undefined) return { ok: false, error: caller.error };
  const { data: period } = await caller.supabase.schema("hr").from("pay_periods").select("ends_on, status").eq("id", id).single();
  if (!period) return { ok: false, error: "That period no longer exists." };
  if (period.status === "paid" || period.status === "closed") return { ok: false, error: "A paid period's dates are history." };
  if (input.payDate < period.ends_on) return { ok: false, error: "Pay date cannot be before the cutoff ends." };
  const { error } = await caller.supabase
    .schema("hr")
    .from("pay_periods")
    .update({ pay_date: input.payDate, notes: input.notes?.trim() || null })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/hr/periods");
  return { ok: true };
}

/**
 * Builds a person's attendance for a period from the live data and stores
 * it on their timesheet row as a draft (or approves it in the same step).
 * The stored summary is what payroll reads; recomputing a draft is free,
 * an approved one must be reopened first.
 */
export async function computePeriodTimesheet(periodId: string, employeeId: string, opts: { approve: boolean; notes?: string | null }): Promise<ActionResult<{ summary: PeriodAttendance }>> {
  const caller = await hrCaller();
  if (caller.error !== undefined) return { ok: false, error: caller.error };
  const { supabase, userId } = caller;

  const [{ data: period }, { data: employee }, { data: existing }] = await Promise.all([
    supabase.schema("hr").from("pay_periods").select("*").eq("id", periodId).single(),
    supabase.schema("hr").from("employees").select("id, staff_id, address").eq("id", employeeId).single(),
    supabase.schema("hr").from("period_timesheets").select("id, status").eq("period_id", periodId).eq("employee_id", employeeId).maybeSingle(),
  ]);
  if (!period) return { ok: false, error: "That period no longer exists." };
  if (!employee) return { ok: false, error: "That employee no longer exists." };
  if (existing?.status === "approved") return { ok: false, error: "This timesheet is approved. Reopen it to recompute." };
  if (period.status !== "open" && period.status !== "timesheets_approved") return { ok: false, error: "This period's payroll has been computed; its timesheets are frozen." };

  const from = period.starts_on as string;
  const to = period.ends_on as string;
  const [{ data: settings }, { data: holidays }, { data: schedules }, { data: overrides }, { data: leaves }, { data: punches }] = await Promise.all([
    supabase.schema("shared").from("app_settings").select("overtime_threshold_minutes, tardiness_grace_minutes").maybeSingle(),
    supabase.schema("hr").from("holidays").select("date, kind, scope_city"),
    supabase.schema("hr").from("work_schedules").select("effective_from, effective_to, pattern, break_minutes, hours_per_day").eq("employee_id", employeeId),
    supabase.schema("hr").from("schedule_overrides").select("date, start_time, end_time, is_rest_day").eq("employee_id", employeeId).gte("date", from).lte("date", to),
    supabase
      .schema("hr")
      .from("leave_requests")
      .select("starts_on, ends_on, start_half, end_half, leave_type_id, leave_types(paid)")
      .eq("employee_id", employeeId)
      .eq("status", "approved")
      .lte("starts_on", to)
      .gte("ends_on", from),
    employee.staff_id
      ? supabase
          .schema("ops")
          .from("time_punches")
          .select("id, staff_id, punch_type, punched_at, time_entry_id")
          .eq("staff_id", employee.staff_id)
          // A day before the period so an overnight shift clocked in on the
          // last day of the previous period pairs correctly, and a day after
          // so the period's last shift can close.
          .gte("punched_at", `${addDays(from, -1)}T00:00:00+08:00`)
          .lt("punched_at", `${addDays(to, 2)}T00:00:00+08:00`)
          .order("punched_at")
      : Promise.resolve({ data: [] as { id: string; staff_id: string; punch_type: "clock_in" | "clock_out"; punched_at: string; time_entry_id: string | null }[] }),
  ]);

  // The schedule in force on the period's first day; a mid-period change is
  // rare and handled by the override table.
  const schedule = (schedules ?? [])
    .filter((s) => s.effective_from <= to && (s.effective_to === null || s.effective_to > from))
    .sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1))[0];

  const summary = periodAttendance({
    from,
    to,
    schedule: schedule ? { pattern: schedule.pattern, breakMinutes: schedule.break_minutes, hoursPerDay: Number(schedule.hours_per_day) } : null,
    overrides: (overrides ?? []).map((o) => ({ date: o.date, start: o.start_time?.slice(0, 5) ?? null, end: o.end_time?.slice(0, 5) ?? null, isRestDay: o.is_rest_day })),
    sessions: pairSessions(
      (punches ?? []).map((p) => ({ id: p.id, staffId: p.staff_id, punchType: p.punch_type, punchedAt: p.punched_at, timeEntryId: p.time_entry_id ?? undefined }))
    ),
    holidays: (holidays ?? []).map((h) => ({ date: h.date, kind: h.kind, scopeCity: h.scope_city })),
    leaves: (leaves ?? []).map((l) => ({
      from: l.starts_on,
      to: l.ends_on,
      startHalf: l.start_half,
      endHalf: l.end_half,
      typeId: l.leave_type_id,
      paid: Boolean((l.leave_types as unknown as { paid: boolean } | null)?.paid),
    })),
    overtimeThresholdMinutes: settings?.overtime_threshold_minutes ?? 480,
    graceMinutes: settings?.tardiness_grace_minutes ?? 0,
    now: new Date(),
  });

  const row = {
    period_id: periodId,
    employee_id: employeeId,
    summary,
    status: opts.approve ? "approved" : existing?.status === "reopened" ? "reopened" : "draft",
    approved_by: opts.approve ? userId : null,
    approved_at: opts.approve ? new Date().toISOString() : null,
    notes: opts.notes?.trim() || null,
  };
  const { error } = await supabase.schema("hr").from("period_timesheets").upsert(row, { onConflict: "period_id,employee_id" });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/hr/timesheets");
  return { ok: true, data: { summary } };
}

/** Puts an approved timesheet back to draft so it can be recomputed (a punch was corrected after approval). */
export async function reopenPeriodTimesheet(id: string, reason: string): Promise<ActionResult> {
  if (!reason.trim()) return { ok: false, error: "Say why it is being reopened." };
  const caller = await hrCaller();
  if (caller.error !== undefined) return { ok: false, error: caller.error };
  const { data: ts } = await caller.supabase.schema("hr").from("period_timesheets").select("period_id, notes, pay_periods(status)").eq("id", id).single();
  if (!ts) return { ok: false, error: "That timesheet no longer exists." };
  const periodStatus = (ts.pay_periods as unknown as { status: string } | null)?.status;
  if (periodStatus && periodStatus !== "open" && periodStatus !== "timesheets_approved") return { ok: false, error: "This period's payroll has been computed; reopen is not possible." };
  const { error } = await caller.supabase
    .schema("hr")
    .from("period_timesheets")
    .update({ status: "reopened", approved_by: null, approved_at: null, notes: [ts.notes, `Reopened: ${reason.trim()}`].filter(Boolean).join("\n") })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  // The period can no longer be "timesheets approved".
  await caller.supabase.schema("hr").from("pay_periods").update({ status: "open" }).eq("id", ts.period_id).eq("status", "timesheets_approved");
  revalidatePath("/hr/timesheets");
  return { ok: true };
}

/** Marks the period's timesheets complete once every active employee's is approved. */
export async function markPeriodTimesheetsApproved(periodId: string): Promise<ActionResult> {
  const caller = await hrCaller();
  if (caller.error !== undefined) return { ok: false, error: caller.error };
  const [{ data: period }, { data: employees }, { data: sheets }] = await Promise.all([
    caller.supabase.schema("hr").from("pay_periods").select("status, starts_on, ends_on").eq("id", periodId).single(),
    caller.supabase.schema("hr").from("employees").select("id, hire_date, separation_date, status"),
    caller.supabase.schema("hr").from("period_timesheets").select("employee_id, status").eq("period_id", periodId),
  ]);
  if (!period) return { ok: false, error: "That period no longer exists." };
  if (period.status !== "open") return { ok: false, error: "Only an open period can be marked." };
  const due = (employees ?? []).filter((e) => (e.status === "active" || e.status === "on_leave") && e.hire_date <= period.ends_on && (e.separation_date === null || e.separation_date >= period.starts_on));
  const approved = new Set((sheets ?? []).filter((s) => s.status === "approved").map((s) => s.employee_id));
  const missing = due.filter((e) => !approved.has(e.id));
  if (missing.length) return { ok: false, error: `${missing.length} timesheet${missing.length === 1 ? " is" : "s are"} not approved yet.` };
  const { error } = await caller.supabase.schema("hr").from("pay_periods").update({ status: "timesheets_approved" }).eq("id", periodId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/hr/periods");
  revalidatePath("/hr/timesheets");
  return { ok: true };
}
