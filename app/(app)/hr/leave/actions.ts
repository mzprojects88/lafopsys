"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { leaveBalance, requestDays, statutoryEligibility, type LeaveTypeRules } from "@/lib/utils/leave";
import { todayIso } from "@/lib/utils/date";
import type { ActionResult } from "../actions";
import type { LeaveAdjustmentKind } from "@/lib/types/hr";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function signedIn() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: staff } = await supabase.schema("shared").from("staff").select("role, is_hr, active").eq("id", user.id).single();
  if (!staff?.active) return null;
  return { supabase, userId: user.id, isHr: staff.role === "admin" || Boolean(staff.is_hr) };
}

export interface LeaveRequestInput {
  /** HR may file for someone else; an employee files for themselves (ignored unless HR). */
  employeeId?: string | null;
  leaveTypeId: string;
  startsOn: string;
  endsOn: string;
  startHalf: boolean;
  endHalf: boolean;
  reason?: string | null;
  documentUrl?: string | null;
}

/**
 * Files a request. Runs as the caller: an employee's insert is allowed by
 * the "own leave request insert" policy (pending, undecided); HR's by "hr
 * manage". `days` is computed here over the person's schedule so the
 * balance and payroll agree on the length; eligibility and balance are
 * checked so the person gets a sentence, not an approval that bounces.
 */
export async function submitLeaveRequest(input: LeaveRequestInput): Promise<ActionResult<{ days: number }>> {
  if (!DATE_RE.test(input.startsOn) || !DATE_RE.test(input.endsOn)) return { ok: false, error: "Start and end dates are required." };
  if (input.endsOn < input.startsOn) return { ok: false, error: "The end date is before the start date." };
  const url = input.documentUrl?.trim() || null;
  if (url && !/^https?:\/\//i.test(url)) return { ok: false, error: "The document link should start with http:// or https://." };
  const caller = await signedIn();
  if (!caller) return { ok: false, error: "Not signed in." };
  const { supabase, userId, isHr } = caller;

  // Whose request this is.
  let employeeId: string | null = null;
  if (isHr && input.employeeId) employeeId = input.employeeId;
  else {
    const { data: me } = await supabase.schema("hr").from("employees").select("id").eq("staff_id", userId).maybeSingle();
    employeeId = me?.id ?? null;
  }
  if (!employeeId) return { ok: false, error: "No employee record is linked to your login. Ask HR to link it." };

  const today = todayIso();
  const [{ data: employee }, { data: type }, { data: settings }, { data: holidays }, { data: schedules }, { data: overrides }, { data: adjustments }, { data: requests }] =
    await Promise.all([
      supabase.schema("hr").from("employees").select("id, hire_date, separation_date, sex, civil_status, status").eq("id", employeeId).single(),
      supabase.schema("hr").from("leave_types").select("*").eq("id", input.leaveTypeId).single(),
      supabase.schema("shared").from("app_settings").select("leave_vl_days_per_year, leave_sl_days_per_year").maybeSingle(),
      supabase.schema("hr").from("holidays").select("date, kind, scope_city"),
      supabase.schema("hr").from("work_schedules").select("effective_from, effective_to, pattern, break_minutes, hours_per_day").eq("employee_id", employeeId),
      supabase.schema("hr").from("schedule_overrides").select("date, start_time, end_time, is_rest_day").eq("employee_id", employeeId).gte("date", input.startsOn).lte("date", input.endsOn),
      supabase.schema("hr").from("leave_adjustments").select("leave_type_id, year, kind, days").eq("employee_id", employeeId),
      supabase.schema("hr").from("leave_requests").select("id, leave_type_id, status, days, starts_on, ends_on").eq("employee_id", employeeId),
    ]);
  if (!employee) return { ok: false, error: "Employee record not found." };
  if (!type) return { ok: false, error: "Unknown leave type." };
  if (!type.active) return { ok: false, error: `${type.name} is not available to request.` };
  if (employee.status === "resigned" || employee.status === "terminated") return { ok: false, error: "This person has been separated." };

  // Overlap with another live request.
  const clash = (requests ?? []).find((r) => (r.status === "pending" || r.status === "approved") && r.starts_on <= input.endsOn && r.ends_on >= input.startsOn);
  if (clash) return { ok: false, error: `Overlaps a ${clash.status} request (${clash.starts_on} to ${clash.ends_on}).` };

  const schedule = (schedules ?? [])
    .filter((s) => s.effective_from <= input.endsOn && (s.effective_to === null || s.effective_to > input.startsOn))
    .sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1))[0];
  const days = requestDays({
    from: input.startsOn,
    to: input.endsOn,
    startHalf: input.startHalf,
    endHalf: input.endHalf,
    schedule: schedule ? { pattern: schedule.pattern, breakMinutes: schedule.break_minutes, hoursPerDay: Number(schedule.hours_per_day) } : null,
    overrides: (overrides ?? []).map((o) => ({ date: o.date, start: o.start_time?.slice(0, 5) ?? null, end: o.end_time?.slice(0, 5) ?? null, isRestDay: o.is_rest_day })),
    holidays: (holidays ?? []).map((h) => ({ date: h.date, kind: h.kind, scopeCity: h.scope_city })),
  });
  if (days <= 0) return { ok: false, error: "Those dates have no scheduled workdays." };

  const rules = (type.eligibility ?? {}) as LeaveTypeRules;
  const prior = (requests ?? []).filter((r) => r.leave_type_id === type.id && r.status === "approved").length;
  const elig = statutoryEligibility({ rules, hireDate: employee.hire_date, asOf: input.startsOn, sex: employee.sex, civilStatus: employee.civil_status, priorOccurrences: prior });
  if (!elig.eligible) return { ok: false, error: elig.reason ?? "Not eligible." };
  if (type.requires_document && !url && !isHr) return { ok: false, error: `${type.name} needs a supporting document link.` };

  // Balance check for the accrued kinds (VL, SL, SIL); per-event statutory
  // leaves are checked against their fixed days.
  const entitlement =
    type.entitlement_source === "settings_vl"
      ? Number(settings?.leave_vl_days_per_year ?? 5)
      : type.entitlement_source === "settings_sl"
        ? Number(settings?.leave_sl_days_per_year ?? 5)
        : Number(type.days_default ?? 0);
  if (rules.perEvent) {
    if (entitlement > 0 && days > entitlement) return { ok: false, error: `${type.name} is up to ${entitlement} days per event.` };
  } else if (type.paid && entitlement > 0) {
    const year = Number(input.startsOn.slice(0, 4));
    const bal = leaveBalance({
      typeId: type.id,
      year,
      entitlementPerYear: entitlement,
      hireDate: employee.hire_date,
      asOf: input.startsOn > today ? today : input.startsOn,
      separationDate: employee.separation_date,
      adjustments: (adjustments ?? []).map((a) => ({ leaveTypeId: a.leave_type_id, year: a.year, kind: a.kind, days: Number(a.days) })),
      requests: (requests ?? []).map((r) => ({ leaveTypeId: r.leave_type_id, status: r.status, days: Number(r.days), startsOn: r.starts_on })),
    });
    // Allow up to the full year's entitlement (accrual continues); refuse beyond it.
    const ceiling = Math.max(bal.available, bal.entitled + bal.carriedIn - bal.used - bal.converted);
    if (days > ceiling + 1e-9) return { ok: false, error: `Only ${ceiling.toFixed(2)} ${type.name.toLowerCase()} day(s) left for ${year}.` };
  }

  const { error } = await supabase.schema("hr").from("leave_requests").insert({
    employee_id: employeeId,
    leave_type_id: type.id,
    starts_on: input.startsOn,
    ends_on: input.endsOn,
    start_half: input.startHalf,
    end_half: input.endHalf,
    days,
    reason: input.reason?.trim() || null,
    document_url: url,
    status: "pending",
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/hr/leave");
  return { ok: true, data: { days } };
}

/** The owner withdraws a pending request. The 0040 trigger allows only this transition. */
export async function cancelLeaveRequest(id: string): Promise<ActionResult> {
  const caller = await signedIn();
  if (!caller) return { ok: false, error: "Not signed in." };
  const { error } = await caller.supabase.schema("hr").from("leave_requests").update({ status: "cancelled" }).eq("id", id).eq("status", "pending");
  if (error) return { ok: false, error: /42501|pending/.test(error.message) ? "Only a pending request can be withdrawn." : error.message };
  revalidatePath("/hr/leave");
  return { ok: true };
}

export async function decideLeaveRequest(id: string, decision: "approved" | "rejected", note?: string | null): Promise<ActionResult> {
  const caller = await signedIn();
  if (!caller) return { ok: false, error: "Not signed in." };
  if (!caller.isHr) return { ok: false, error: "Only admins and HR decide leave." };
  if (decision === "rejected" && !note?.trim()) return { ok: false, error: "Say why it is rejected." };
  const { data: req } = await caller.supabase.schema("hr").from("leave_requests").select("status, employee_id").eq("id", id).single();
  if (!req) return { ok: false, error: "That request no longer exists." };
  if (req.status !== "pending") return { ok: false, error: "This request has already been decided." };
  const { data: me } = await caller.supabase.schema("hr").from("employees").select("id").eq("staff_id", caller.userId).maybeSingle();
  if (me && me.id === req.employee_id) return { ok: false, error: "You cannot decide your own leave. Another admin or HR person must." };
  const { error } = await caller.supabase
    .schema("hr")
    .from("leave_requests")
    .update({ status: decision, decided_by: caller.userId, decided_at: new Date().toISOString(), decision_note: note?.trim() || null })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/hr/leave");
  return { ok: true };
}

export async function addLeaveAdjustment(input: { employeeId: string; leaveTypeId: string; year: number; kind: LeaveAdjustmentKind; days: number; note?: string | null }): Promise<ActionResult> {
  const caller = await signedIn();
  if (!caller) return { ok: false, error: "Not signed in." };
  if (!caller.isHr) return { ok: false, error: "Only admins and HR adjust balances." };
  if (!Number.isFinite(input.days) || input.days === 0) return { ok: false, error: "Days must be a non-zero number." };
  if (!Number.isInteger(input.year) || input.year < 2020 || input.year > 2100) return { ok: false, error: "Year out of range." };
  if (!input.note?.trim()) return { ok: false, error: "A note is required — adjustments are audited." };
  const { error } = await caller.supabase.schema("hr").from("leave_adjustments").insert({
    employee_id: input.employeeId,
    leave_type_id: input.leaveTypeId,
    year: input.year,
    kind: input.kind,
    days: input.days,
    note: input.note.trim(),
    created_by: caller.userId,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/hr/leave");
  return { ok: true };
}
