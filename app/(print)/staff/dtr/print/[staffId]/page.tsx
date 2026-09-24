import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { addDays, dayKey, formatMinutes, pairSessions, zonedDayStart } from "@/lib/utils/dtr";
import { periodAttendance, type DayAttendance } from "@/lib/utils/attendance";
import { dtrPrintRows, type PrintPunch } from "@/lib/utils/dtr-print";
import { payPeriodLabel, periodFor, semiMonthlyPeriods } from "@/lib/utils/pay-period";
import { formatDate } from "@/lib/utils/date";
import { PrintButton } from "@/app/(print)/hr/payslips/[id]/print/print-button";

/**
 * The printed DTR for one pay period (DTR plan phase 5): each day's arrival
 * and departure, hours, and what was missing or corrected, with lines for
 * the employee's and the supervisor's signatures, after CS Form 48.
 *
 * Read under the caller's RLS: staff print their own; admins, finance and HR
 * anyone's. `?period=2026-18` (payPeriodKey); default the current period.
 */
export default async function DtrPrintPage({ params, searchParams }: { params: Promise<{ staffId: string }>; searchParams: Promise<{ period?: string }> }) {
  const { staffId } = await params;
  const { period } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: person } = await supabase.schema("shared").from("staff").select("first_name, last_name, position").eq("id", staffId).maybeSingle();
  if (!person) notFound();

  const today = dayKey(new Date());
  const m = /^(\d{4})-(\d{2})$/.exec(period ?? "");
  const spec = m && Number(m[2]) >= 1 && Number(m[2]) <= 24 ? semiMonthlyPeriods(Number(m[1]))[Number(m[2]) - 1] : periodFor(today);

  // Someone else's DTR: only for the roles the punches' RLS lets read it (0017, 0041).
  // Finance reads punches but not other people's leave, so it gets hours only.
  let judges = true;
  if (staffId !== user.id) {
    const [{ data: isHr }, { data: me }] = await Promise.all([
      supabase.schema("hr").rpc("is_hr_staff"),
      supabase.schema("shared").from("staff").select("role").eq("id", user.id).maybeSingle(),
    ]);
    if (isHr !== true && me?.role !== "finance") notFound();
    judges = isHr === true;
  }

  // The period plus the next day, so the last night shift's clock-out is in.
  const { data: rows, error } = await supabase
    .schema("ops")
    .from("time_punches")
    .select("id, staff_id, punch_type, punched_at, time_entry_id, source, site_status")
    .eq("staff_id", staffId)
    .gte("punched_at", zonedDayStart(spec.from).toISOString())
    .lt("punched_at", zonedDayStart(addDays(spec.to, 2)).toISOString());
  if (error) throw new Error(error.message);
  type Row = { id: string; staff_id: string; punch_type: "clock_in" | "clock_out"; punched_at: string; time_entry_id: string | null; source: "device" | "adjustment"; site_status: PrintPunch["siteStatus"] };
  const punches: PrintPunch[] = ((rows ?? []) as Row[]).map((r) => ({
    id: r.id,
    staffId: r.staff_id,
    punchType: r.punch_type,
    punchedAt: r.punched_at,
    timeEntryId: r.time_entry_id ?? undefined,
    source: r.source,
    siteStatus: r.site_status,
  }));
  const dtr = dtrPrintRows(punches, staffId, spec.from, spec.to, today);

  // Late, undertime, absences, leave and holidays: the same arithmetic the
  // timesheets and payroll use (lib/utils/attendance.ts, as in
  // hr/periods/actions.ts), whenever the person has a schedule (phase 3).
  const { data: link } = await supabase.schema("hr").from("v_roster").select("employee_id").eq("staff_id", staffId).maybeSingle();
  let attendance: Map<string, DayAttendance> | null = null;
  let lateTotal = 0;
  let underTotal = 0;
  if (judges && link?.employee_id) {
    const employeeId = link.employee_id as string;
    const [{ data: settings }, { data: holidays }, { data: schedules }, { data: overrides }, { data: leaves }] = await Promise.all([
      supabase.schema("shared").from("app_settings").select("overtime_threshold_minutes, tardiness_grace_minutes").maybeSingle(),
      supabase.schema("hr").from("holidays").select("date, kind, scope_city"),
      supabase.schema("hr").from("work_schedules").select("effective_from, effective_to, pattern, break_minutes, hours_per_day").eq("employee_id", employeeId),
      supabase.schema("hr").from("schedule_overrides").select("date, start_time, end_time, is_rest_day").eq("employee_id", employeeId).gte("date", spec.from).lte("date", spec.to),
      supabase
        .schema("hr")
        .from("leave_requests")
        .select("starts_on, ends_on, start_half, end_half, leave_type_id, leave_types(paid)")
        .eq("employee_id", employeeId)
        .eq("status", "approved")
        .lte("starts_on", spec.to)
        .gte("ends_on", spec.from),
    ]);
    const schedule = (schedules ?? [])
      .filter((x) => x.effective_from <= spec.to && (x.effective_to === null || x.effective_to > spec.from))
      .sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1))[0];
    if (schedule) {
      const summary = periodAttendance({
        from: spec.from,
        to: spec.to,
        schedule: { pattern: schedule.pattern, breakMinutes: schedule.break_minutes, hoursPerDay: Number(schedule.hours_per_day) },
        overrides: (overrides ?? []).map((o) => ({ date: o.date, start: o.start_time?.slice(0, 5) ?? null, end: o.end_time?.slice(0, 5) ?? null, isRestDay: o.is_rest_day })),
        sessions: pairSessions(punches),
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
      attendance = new Map(summary.days.map((d) => [d.day, d]));
      lateTotal = summary.totals.lateMinutes;
      underTotal = summary.totals.undertimeMinutes;
    }
  }
  const dayNote = (a: DayAttendance | undefined): string[] => {
    if (!a) return [];
    const notes: string[] = [];
    if (a.leave) notes.push(a.leave.fraction === 0.5 ? "Half-day leave" : "On leave");
    if (a.holiday === "regular") notes.push("Regular holiday");
    if (a.holiday === "special_non_working") notes.push("Special holiday");
    if (a.absent > 0) notes.push(a.absent === 0.5 ? "Absent half day" : "Absent");
    if (a.dayClass === "rest_day" && a.workedMinutes === 0) notes.push("Rest day");
    return notes;
  };
  const name = `${person.first_name} ${person.last_name}`;
  const width = Math.max(2, ...dtr.rows.map((r) => r.sessions.length));
  const shown = Math.min(width, 3);

  return (
    <div className="mx-auto max-w-3xl p-6 text-sm text-neutral-900 print:max-w-none print:p-0">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href="/staff/dtr" className="text-xs underline">
          Back to the DTR
        </Link>
        <PrintButton />
      </div>
      <div className="rounded-xl border border-neutral-300 p-8 print:rounded-none print:border-0 print:p-0">
        <header className="flex items-center gap-3 border-b border-neutral-300 pb-4">
          <Image src="/logo/laf-mark.png" alt="" width={40} height={42} />
          <div className="flex flex-col">
            <span className="font-semibold">Little Ark Foundation</span>
            <span className="text-xs text-neutral-600">DAILY TIME RECORD</span>
          </div>
          <div className="ml-auto text-right text-xs">
            <div className="font-semibold">{payPeriodLabel(spec)}</div>
            <div className="text-neutral-600">Pay period</div>
          </div>
        </header>

        <div className="mt-4 flex flex-wrap justify-between gap-2">
          <div>
            <div className="text-base font-semibold">{name}</div>
            <div className="text-xs text-neutral-600">{person.position}</div>
          </div>
          <div className="text-right text-xs">
            <div>
              Days present: <strong>{dtr.daysPresent}</strong>
            </div>
            <div>
              Hours worked: <strong>{formatMinutes(dtr.totalMinutes)}</strong>
            </div>
          </div>
        </div>

        <table className="mt-4 w-full border-collapse text-xs">
          <thead>
            <tr className="border-y border-neutral-400 text-left">
              <th className="py-1 pr-2 font-semibold">Date</th>
              {Array.from({ length: shown }, (_, i) => (
                <React.Fragment key={i}>
                  <th className="py-1 pr-2 font-semibold">In</th>
                  <th className="py-1 pr-2 font-semibold">Out</th>
                </React.Fragment>
              ))}
              <th className="py-1 pr-2 text-right font-semibold">Hours</th>
              {attendance ? (
                <>
                  <th className="py-1 pr-2 text-right font-semibold">Late</th>
                  <th className="py-1 pr-2 text-right font-semibold">Under</th>
                </>
              ) : null}
              <th className="py-1 font-semibold">Remarks</th>
            </tr>
          </thead>
          <tbody>
            {dtr.rows.map((r) => {
              const extra = r.sessions.slice(shown).map((s) => `${s.in}–${s.out || "?"}`);
              const a = attendance?.get(r.day);
              const remarks = [...dayNote(a), ...r.remarks, ...(extra.length ? [`Also ${extra.join(", ")}`] : [])];
              const weekend = r.weekday === "Sat" || r.weekday === "Sun";
              return (
                <tr key={r.day} className={`border-b border-neutral-200 ${weekend ? "bg-neutral-50 print:bg-transparent" : ""}`}>
                  <td className="py-1 pr-2 whitespace-nowrap">
                    {r.weekday} {formatDate(r.day, "MMM d")}
                  </td>
                  {Array.from({ length: shown }, (_, i) => (
                    <React.Fragment key={i}>
                      <td className="py-1 pr-2 tabular-nums">{r.sessions[i]?.in ?? ""}</td>
                      <td className="py-1 pr-2 tabular-nums">{r.sessions[i] ? r.sessions[i].out || "—" : ""}</td>
                    </React.Fragment>
                  ))}
                  <td className="py-1 pr-2 text-right tabular-nums">{r.minutes ? formatMinutes(r.minutes) : ""}</td>
                  {attendance ? (
                    <>
                      <td className="py-1 pr-2 text-right tabular-nums">{a?.lateMinutes ? `${a.lateMinutes}m` : ""}</td>
                      <td className="py-1 pr-2 text-right tabular-nums">{a?.undertimeMinutes ? `${a.undertimeMinutes}m` : ""}</td>
                    </>
                  ) : null}
                  <td className="py-1 text-neutral-700">{remarks.join("; ")}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-neutral-400 font-semibold">
              <td className="py-1 pr-2" colSpan={1 + shown * 2}>
                Total
              </td>
              <td className="py-1 pr-2 text-right tabular-nums">{formatMinutes(dtr.totalMinutes)}</td>
              {attendance ? (
                <>
                  <td className="py-1 pr-2 text-right tabular-nums">{lateTotal ? formatMinutes(lateTotal) : ""}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{underTotal ? formatMinutes(underTotal) : ""}</td>
                </>
              ) : null}
              <td />
            </tr>
          </tfoot>
        </table>

        <p className="mt-6 text-xs leading-5">
          I certify on my honor that the above is a true and correct report of the hours of work performed, record of which was made daily at the time
          of arrival and departure.
        </p>
        <div className="mt-10 grid grid-cols-2 gap-10 text-xs">
          <div>
            <div className="border-t border-neutral-500 pt-1 font-semibold">{name}</div>
            <div className="text-neutral-600">Employee</div>
          </div>
          <div>
            <div className="border-t border-neutral-500 pt-1 font-semibold">&nbsp;</div>
            <div className="text-neutral-600">Verified by: Supervisor / HR</div>
          </div>
        </div>
        <p className="mt-8 text-[10px] text-neutral-500">
          From the LAF Operating System, printed {formatDate(today, "MMMM d, yyyy")}. Times are Manila time, taken from each clock-in and clock-out. A
          corrected time was added only on an approved request or by an admin, and its reason is on the record.
          {attendance
            ? " Late and undertime are measured against the work schedule, after the grace period."
            : judges
              ? " No work schedule is on file, so late and undertime are not shown."
              : " Late, undertime and leave are on HR's copy."}
        </p>
      </div>
    </div>
  );
}
