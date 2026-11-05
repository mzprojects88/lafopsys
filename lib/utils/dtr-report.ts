// The DTR report (HR > Reports, Nov 2026): one row per employee for a range -- days, punches,
// hours, late, undertime, overtime, missed clock-outs, absences, leave -- as the table, the CSV,
// the branded document and the figures the AI compares (totals only: no names go to the AI).
// Pure: loads under `node --test`.

import type { AnalysisInput } from "../ai/report-analysis.ts";
import type { ReportSpec } from "../pdf/report-doc.ts";

export interface DtrReportRow {
  employeeId: string;
  staffId: string;
  name: string;
  position: string;
  scheduledDays: number;
  daysWorked: number;
  punchesIn: number;
  punchesOut: number;
  workedMinutes: number;
  lateDays: number;
  lateMinutes: number;
  undertimeMinutes: number;
  overtimeMinutes: number;
  missedPunches: number;
  absences: number;
  leaveDays: number;
}

export const DTR_COLUMNS = ["Employee", "Position", "Sched. days", "Days worked", "Clock-ins", "Clock-outs", "Hours", "Late (days)", "Late (min)", "Undertime (min)", "Overtime (min)", "Missed clock-outs", "Absences", "Leave days"] as const;

export const hours = (minutes: number) => Math.round((minutes / 60) * 10) / 10;

export function dtrTotals(rows: readonly DtrReportRow[]) {
  const sum = (k: keyof DtrReportRow) => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);
  return {
    employees: rows.length,
    scheduledDays: sum("scheduledDays"),
    daysWorked: sum("daysWorked"),
    punchesIn: sum("punchesIn"),
    punchesOut: sum("punchesOut"),
    workedMinutes: sum("workedMinutes"),
    lateDays: sum("lateDays"),
    lateMinutes: sum("lateMinutes"),
    undertimeMinutes: sum("undertimeMinutes"),
    overtimeMinutes: sum("overtimeMinutes"),
    missedPunches: sum("missedPunches"),
    absences: sum("absences"),
    leaveDays: sum("leaveDays"),
    withLates: rows.filter((r) => r.lateDays > 0).length,
    withMissed: rows.filter((r) => r.missedPunches > 0).length,
  };
}

const cells = (r: DtrReportRow): (string | number)[] => [r.name, r.position, r.scheduledDays, r.daysWorked, r.punchesIn, r.punchesOut, hours(r.workedMinutes), r.lateDays, r.lateMinutes, r.undertimeMinutes, r.overtimeMinutes, r.missedPunches, r.absences, r.leaveDays];
const totalCells = (rows: readonly DtrReportRow[]): (string | number)[] => {
  const t = dtrTotals(rows);
  return ["Total", `${t.employees} employees`, t.scheduledDays, t.daysWorked, t.punchesIn, t.punchesOut, hours(t.workedMinutes), t.lateDays, t.lateMinutes, t.undertimeMinutes, t.overtimeMinutes, t.missedPunches, t.absences, t.leaveDays];
};

export function dtrReportCsv(rows: readonly DtrReportRow[]): string {
  const q = (v: string | number) => (typeof v === "number" ? String(v) : `"${v.replace(/"/g, '""')}"`);
  return [[...DTR_COLUMNS].map(q).join(","), ...rows.map((r) => cells(r).map(q).join(",")), totalCells(rows).map(q).join(",")].join("\n");
}

/** "+20%", "-5%", "new" (from nothing), or "" when both are nothing. */
function change(current: number, previous: number): string {
  if (previous === 0) return current === 0 ? "" : "new";
  const pct = Math.round(((current - previous) / previous) * 100);
  return `${pct >= 0 ? "+" : ""}${pct}%`;
}

export function dtrReport(args: { rows: readonly DtrReportRow[]; previous: readonly DtrReportRow[]; period: string; previousPeriod: string }): { spec: ReportSpec; input: AnalysisInput } {
  const { rows, previous, period, previousPeriod } = args;
  const t = dtrTotals(rows);
  const p = dtrTotals(previous);
  const kpi = (label: string, cur: number, prev: number, fmt: (n: number) => string = (n) => n.toLocaleString("en-US")) => ({ label, value: fmt(cur), previous: fmt(prev), change: change(cur, prev), cur, prev });
  const kpis = [
    kpi("Hours worked", hours(t.workedMinutes), hours(p.workedMinutes)),
    kpi("Days worked", t.daysWorked, p.daysWorked),
    kpi("Late arrivals (days)", t.lateDays, p.lateDays),
    kpi("Late minutes", t.lateMinutes, p.lateMinutes),
    kpi("Undertime minutes", t.undertimeMinutes, p.undertimeMinutes),
    kpi("Overtime minutes", t.overtimeMinutes, p.overtimeMinutes),
    kpi("Missed clock-outs", t.missedPunches, p.missedPunches),
    kpi("Absences", t.absences, p.absences),
  ];
  const sorted = [...rows].sort((a, b) => b.workedMinutes - a.workedMinutes);
  const spec: ReportSpec = {
    title: "DTR Report",
    subtitle: "Daily time record of every employee with a login: punches, hours, late, undertime, overtime, missed clock-outs, absences and leave",
    period,
    previousPeriod,
    sections: [
      {
        heading: "Attendance",
        description: "From every clock-in and clock-out against each employee's work schedule, holidays and approved leave; the same arithmetic the timesheets and payroll use.",
        kpis: kpis.map(({ label, value, previous: prev, change: c }) => ({ label, value, previous: prev, change: c })),
        table: { columns: [...DTR_COLUMNS], rows: rows.map(cells), totals: totalCells(rows) },
        chart: { kind: "rank", labels: sorted.map((r) => r.name), series: [{ label: "Hours worked", values: sorted.map((r) => hours(r.workedMinutes)) }] },
      },
    ],
  };
  const input: AnalysisInput = {
    title: "DTR Report",
    period,
    previousPeriod,
    sections: [
      {
        heading: "Attendance",
        description: `${t.employees} employees with a login (${p.employees} in the previous range). ${t.withLates} had at least one late arrival; ${t.withMissed} had a missed clock-out.`,
        kpis: kpis.map((k) => ({ label: k.label, value: k.cur, previous: k.prev })),
      },
    ],
  };
  return { spec, input };
}
