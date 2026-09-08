"use client";

import * as React from "react";
import { StatusBadge } from "@/components/patterns/status-badge";
import { formatDate } from "@/lib/utils/date";
import { formatMinutes } from "@/lib/utils/dtr";
import type { DayAttendance, PeriodAttendance, PremiumClass } from "@/lib/utils/attendance";

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

/** One period for one person: the totals payroll will use, then every day. */
export function TimesheetSummaryTable({ summary }: { summary: PeriodAttendance }) {
  const t = summary.totals;
  const premiums = (Object.keys(t.byPremium) as PremiumClass[]).filter((k) => {
    const b = t.byPremium[k];
    return b.minutes + b.overtimeMinutes + b.nightMinutes + b.nightOvertimeMinutes > 0;
  });
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
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
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-1 text-left font-medium">Class</th>
              <th className="py-1 text-right font-medium">Days</th>
              <th className="py-1 text-right font-medium">Regular</th>
              <th className="py-1 text-right font-medium">Overtime</th>
              <th className="py-1 text-right font-medium">Night</th>
              <th className="py-1 text-right font-medium">Night OT</th>
            </tr>
          </thead>
          <tbody>
            {premiums.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-1 text-muted-foreground">
                  No hours in this period.
                </td>
              </tr>
            ) : (
              premiums.map((k) => {
                const b = t.byPremium[k];
                return (
                  <tr key={k} className="border-t">
                    <td className="py-1">{PREMIUM_LABEL[k]}</td>
                    <td className="py-1 text-right tabular-nums">{b.days}</td>
                    <td className="py-1 text-right tabular-nums">{formatMinutes(b.minutes)}</td>
                    <td className="py-1 text-right tabular-nums">{formatMinutes(b.overtimeMinutes)}</td>
                    <td className="py-1 text-right tabular-nums">{formatMinutes(b.nightMinutes)}</td>
                    <td className="py-1 text-right tabular-nums">{formatMinutes(b.nightOvertimeMinutes)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <details>
        <summary className="cursor-pointer text-xs text-muted-foreground">Every day</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-1 text-left font-medium">Day</th>
                <th className="py-1 text-left font-medium">Scheduled</th>
                <th className="py-1 text-right font-medium">Worked</th>
                <th className="py-1 text-right font-medium">Paid</th>
                <th className="py-1 text-right font-medium">OT</th>
                <th className="py-1 text-right font-medium">Late</th>
                <th className="py-1 text-right font-medium">Under</th>
                <th className="py-1 text-left font-medium">Class</th>
                <th className="py-1 text-left font-medium">Flag</th>
              </tr>
            </thead>
            <tbody>
              {summary.days.map((d) => (
                <tr key={d.day} className="border-t">
                  <td className="py-1 whitespace-nowrap">{formatDate(d.day, "EEE d")}</td>
                  <td className="py-1 whitespace-nowrap">{d.scheduled ? `${d.scheduled.start}–${d.scheduled.end}` : d.dayClass === "rest_day" ? "Rest" : "—"}</td>
                  <td className="py-1 text-right tabular-nums">{d.workedMinutes ? formatMinutes(d.workedMinutes) : ""}</td>
                  <td className="py-1 text-right tabular-nums">{d.paidMinutes ? formatMinutes(d.paidMinutes) : ""}</td>
                  <td className="py-1 text-right tabular-nums">{d.overtimeMinutes ? formatMinutes(d.overtimeMinutes) : ""}</td>
                  <td className="py-1 text-right tabular-nums">{d.lateMinutes || ""}</td>
                  <td className="py-1 text-right tabular-nums">{d.undertimeMinutes || ""}</td>
                  <td className="py-1">{d.premium === "ordinary" ? "" : PREMIUM_LABEL[d.premium]}</td>
                  <td className="py-1">
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
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`font-medium tabular-nums ${tone === "negative" ? "text-red-700 dark:text-red-400" : tone === "warning" ? "text-amber-700 dark:text-amber-400" : ""}`}>{value}</span>
    </div>
  );
}
