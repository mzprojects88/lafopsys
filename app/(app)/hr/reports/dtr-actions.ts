"use server";

import { createClient } from "@/lib/supabase/server";
import { callerRunsHr } from "@/lib/rbac/server-powers";
import { addDays, pairSessions, zonedDayStart } from "@/lib/utils/dtr";
import { periodAttendance } from "@/lib/utils/attendance";
import type { DtrReportRow } from "@/lib/utils/dtr-report";

/**
 * The DTR report's rows for a range (HR > Reports, Nov 2026): every employee with a login, judged
 * with the same arithmetic as the printed DTR and the timesheets (lib/utils/attendance.ts) --
 * punches against the work schedule, overrides, holidays and approved leave. Built here as the
 * signed-in HR person under their own RLS; admins and HR only.
 */
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function dtrReportData(from: string, to: string): Promise<{ rows: DtrReportRow[] } | { error: string }> {
  if (!DAY.test(from) || !DAY.test(to) || to < from) return { error: "Give a date range." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  if (!(await callerRunsHr(supabase))) return { error: "Only admins and HR can see the DTR report." };

  const { data: employees, error: eErr } = await supabase.schema("hr").from("employees").select("id, staff_id, first_name, last_name, position, status").not("staff_id", "is", null);
  if (eErr) return { error: eErr.message };
  const people = (employees ?? []).filter((e) => e.staff_id);
  if (!people.length) return { rows: [] };
  const staffIds = people.map((e) => e.staff_id as string);
  const employeeIds = people.map((e) => e.id as string);

  // The range plus the next day, so the last night shift's clock-out is in (as the printed DTR does).
  const [{ data: punches, error: pErr }, { data: settings }, { data: holidays }, { data: schedules }, { data: overrides }, { data: leaves }] = await Promise.all([
    supabase.schema("ops").from("time_punches").select("id, staff_id, punch_type, punched_at, time_entry_id").in("staff_id", staffIds).gte("punched_at", zonedDayStart(from).toISOString()).lt("punched_at", zonedDayStart(addDays(to, 2)).toISOString()),
    supabase.schema("shared").from("app_settings").select("overtime_threshold_minutes, tardiness_grace_minutes").maybeSingle(),
    supabase.schema("hr").from("holidays").select("date, kind, scope_city"),
    supabase.schema("hr").from("work_schedules").select("employee_id, effective_from, effective_to, pattern, break_minutes, hours_per_day").in("employee_id", employeeIds),
    supabase.schema("hr").from("schedule_overrides").select("employee_id, date, start_time, end_time, is_rest_day").in("employee_id", employeeIds).gte("date", from).lte("date", to),
    supabase.schema("hr").from("leave_requests").select("employee_id, starts_on, ends_on, start_half, end_half, leave_type_id, leave_types(paid)").in("employee_id", employeeIds).eq("status", "approved").lte("starts_on", to).gte("ends_on", from),
  ]);
  if (pErr) return { error: pErr.message };

  const sessions = pairSessions(
    (punches ?? []).map((p) => ({ id: p.id as string, staffId: p.staff_id as string, punchType: p.punch_type as "clock_in" | "clock_out", punchedAt: p.punched_at as string, timeEntryId: (p.time_entry_id as string | null) ?? undefined }))
  );
  const holidayRows = (holidays ?? []).map((h) => ({ date: h.date, kind: h.kind, scopeCity: h.scope_city }));
  const now = new Date();

  const rows: DtrReportRow[] = people.map((e) => {
    const staffId = e.staff_id as string;
    const mine = (punches ?? []).filter((p) => p.staff_id === staffId && p.punched_at >= zonedDayStart(from).toISOString() && p.punched_at < zonedDayStart(addDays(to, 1)).toISOString());
    const schedule = (schedules ?? [])
      .filter((s) => s.employee_id === e.id && s.effective_from <= to && (s.effective_to === null || s.effective_to > from))
      .sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1))[0];
    const summary = periodAttendance({
      from,
      to,
      schedule: schedule ? { pattern: schedule.pattern, breakMinutes: schedule.break_minutes, hoursPerDay: Number(schedule.hours_per_day) } : null,
      overrides: (overrides ?? []).filter((o) => o.employee_id === e.id).map((o) => ({ date: o.date, start: o.start_time?.slice(0, 5) ?? null, end: o.end_time?.slice(0, 5) ?? null, isRestDay: o.is_rest_day })),
      sessions: sessions.filter((s) => s.staffId === staffId),
      holidays: holidayRows,
      leaves: (leaves ?? [])
        .filter((l) => l.employee_id === e.id)
        .map((l) => ({ from: l.starts_on, to: l.ends_on, startHalf: l.start_half, endHalf: l.end_half, typeId: l.leave_type_id, paid: Boolean((l.leave_types as unknown as { paid: boolean } | null)?.paid) })),
      overtimeThresholdMinutes: settings?.overtime_threshold_minutes ?? 480,
      graceMinutes: settings?.tardiness_grace_minutes ?? 0,
      now,
    });
    const t = summary.totals;
    return {
      employeeId: e.id as string,
      staffId,
      name: `${e.first_name} ${e.last_name}`,
      position: (e.position as string) ?? "",
      scheduledDays: t.scheduledDays,
      daysWorked: t.daysWorked,
      punchesIn: mine.filter((p) => p.punch_type === "clock_in").length,
      punchesOut: mine.filter((p) => p.punch_type === "clock_out").length,
      workedMinutes: summary.days.reduce((s, d) => s + d.workedMinutes, 0),
      lateDays: summary.days.filter((d) => d.lateMinutes > 0).length,
      lateMinutes: t.lateMinutes,
      undertimeMinutes: t.undertimeMinutes,
      overtimeMinutes: summary.days.reduce((s, d) => s + d.overtimeMinutes, 0),
      missedPunches: t.missedPunches,
      absences: t.absences,
      leaveDays: t.paidLeaveDays + t.unpaidLeaveDays,
    };
  });
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return { rows };
}
