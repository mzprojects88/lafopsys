"use client";

import * as React from "react";
import { StatusBadge } from "@/components/patterns/status-badge";
import { formatDate } from "@/lib/utils/date";
import { formatMinutes } from "@/lib/utils/dtr";
import type { DayAttendance, PeriodAttendance, PremiumClass } from "@/lib/utils/attendance";
import { STATUS_TONE_TEXT } from "@/lib/utils/status-colors";

/** Inventory table look, full-bleed inside the timesheet card. */
const TH = "h-11 px-5 text-theme-xs font-medium whitespace-nowrap text-muted-foreground";
const TD = "px-5 py-3";

export const PREMIUM_LABEL: Record<PremiumClass, string> = {
  ordinary: "Ordinary",
  rest_day: "Rest day",
  special_non_working: "Special day",
  special_on_rest_day: "Special on rest day",
  regular_holiday: "Regular holiday",
  regular_holiday_on_rest_day: "Regular holiday on rest day",
};

const FLAG_LABEL: Record<DayAttendance["flag"], string> = {
  on_time: "On time",
  late: "Late",
  early_out: "Left early",
  missed_punch: "Missed punch",
  absent: "Absent",
  rest_day: "Rest day",
  holiday: "Holiday",
  on_leave: "On leave",
  unscheduled: "No schedule",
};

/** One period for one person: the totals payroll will use, then every day.
 * Drawn flush: the parent card gives it no body padding. */
export function TimesheetSummaryTable({ summary }: { summary: PeriodAttendance }) {
  const t = summary.totals;
  const premiums = (Object.keys(t.byPremium) as PremiumClass[]).filter((k) => {
    const b = t.byPremium[k];
    return b.minutes + b.overtimeMinutes + b.nightMinutes + b.nightOvertimeMinutes > 0;
  });
  return (
    <div className="flex flex-col">
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 px-5 py-4 text-theme-sm sm:grid-cols-4">
        <Stat label="Scheduled days" value={t.scheduledDays} />
        <Stat label="Days worked" value={t.daysWorked} />
        <Stat label="Absences" value={t.absences} tone={t.absences > 0 ? "negative" : undefined} />
        <Stat label="Paid leave" value={t.paidLeaveDays} />
        <Stat label="Late" value={formatMinutes(t.lateMinutes)} tone={t.lateMinutes > 0 ? "warning" : undefined} />
        <Stat label="Undertime" value={formatMinutes(t.undertimeMinutes)} tone={t.undertimeMinutes > 0 ? "warning" : undefined} />
        <Stat label="Unpaid leave" value={t.unpaidLeaveDays} />
        <Stat label="Missed punches" value={t.missedPunches} tone={t.missedPunches > 0 ? "negative" : undefined} />
        <Stat label="Regular holidays (unworked, payable)" value={t.regularHolidaysUnworked} />
      </div>
      <div className="overflow-x-auto border-t border-border">
        <table className="w-full text-theme-sm">
          <thead>
            <tr className="border-b border-border">
              <th className={`${TH} text-left`}>Class</th>
              <th className={`${TH} text-right`}>Days</th>
              <th className={`${TH} text-right`}>Regular</th>
              <th className={`${TH} text-right`}>Overtime</th>
              <th className={`${TH} text-right`}>Night</th>
              <th className={`${TH} text-right`}>Night OT</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {premiums.length === 0 ? (
              <tr>
                <td colSpan={6} className={`${TD} text-muted-foreground`}>
                  No hours in this period.
                </td>
              </tr>
            ) : (
              premiums.map((k) => {
                const b = t.byPremium[k];
                return (
                  <tr key={k} className="hover:bg-muted/60">
                    <td className={TD}>{PREMIUM_LABEL[k]}</td>
                    <td className={`${TD} text-right tabular-nums`}>{b.days}</td>
                    <td className={`${TD} text-right tabular-nums`}>{formatMinutes(b.minutes)}</td>
                    <td className={`${TD} text-right tabular-nums`}>{formatMinutes(b.overtimeMinutes)}</td>
                    <td className={`${TD} text-right tabular-nums`}>{formatMinutes(b.nightMinutes)}</td>
                    <td className={`${TD} text-right tabular-nums`}>{formatMinutes(b.nightOvertimeMinutes)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <details className="border-t border-border">
        <summary className="cursor-pointer px-5 py-3 text-theme-xs text-muted-foreground">Every day</summary>
        <div className="overflow-x-auto border-t border-border">
          <table className="w-full text-theme-sm">
            <thead>
              <tr className="border-b border-border">
                <th className={`${TH} text-left`}>Day</th>
                <th className={`${TH} text-left`}>Scheduled</th>
                <th className={`${TH} text-right`}>Worked</th>
                <th className={`${TH} text-right`}>Paid</th>
                <th className={`${TH} text-right`}>OT</th>
                <th className={`${TH} text-right`}>Late</th>
                <th className={`${TH} text-right`}>Under</th>
                <th className={`${TH} text-left`}>Class</th>
                <th className={`${TH} text-left`}>Flag</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {summary.days.map((d) => (
                <tr key={d.day} className="hover:bg-muted/60">
                  <td className={`${TD} whitespace-nowrap`}>{formatDate(d.day, "EEE d")}</td>
                  <td className={`${TD} whitespace-nowrap`}>{d.scheduled ? `${d.scheduled.start}–${d.scheduled.end}` : d.dayClass === "rest_day" ? "Rest" : "—"}</td>
                  <td className={`${TD} text-right tabular-nums`}>{d.workedMinutes ? formatMinutes(d.workedMinutes) : ""}</td>
                  <td className={`${TD} text-right tabular-nums`}>{d.paidMinutes ? formatMinutes(d.paidMinutes) : ""}</td>
                  <td className={`${TD} text-right tabular-nums`}>{d.overtimeMinutes ? formatMinutes(d.overtimeMinutes) : ""}</td>
                  <td className={`${TD} text-right tabular-nums`}>{d.lateMinutes || ""}</td>
                  <td className={`${TD} text-right tabular-nums`}>{d.undertimeMinutes || ""}</td>
                  <td className={TD}>{d.premium === "ordinary" ? "" : PREMIUM_LABEL[d.premium]}</td>
                  <td className={TD}>
                    <StatusBadge domain="attendance" status={d.flag} label={FLAG_LABEL[d.flag] + (d.leave ? ` (${d.leave.typeId.toUpperCase()}${d.leave.fraction === 0.5 ? " ½" : ""})` : "")} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: "warning" | "negative" }) {
  return (
    <div className="flex flex-col">
      <span className="text-theme-xs text-muted-foreground">{label}</span>
      <span className={`font-medium tabular-nums ${tone ? STATUS_TONE_TEXT[tone] : ""}`}>{value}</span>
    </div>
  );
}
