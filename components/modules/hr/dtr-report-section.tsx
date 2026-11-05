"use client";

import * as React from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import { SectionCard } from "@/components/patterns/section-card";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PeriodPicker, periodStateWindow, type PeriodState } from "@/components/ui/period-picker";
import { AiAnalysisPanel, ReportToolbar, useReportAnalysis } from "@/components/modules/reports/report-ai";
import { dtrReportData } from "@/app/(app)/hr/reports/dtr-actions";
import { DTR_COLUMNS, dtrReport, dtrReportCsv, dtrTotals, hours, type DtrReportRow } from "@/lib/utils/dtr-report";
import { periodLabel, previousWindow, type DayWindow } from "@/lib/utils/period";
import { downloadCsv } from "@/lib/utils/csv";
import { formatMinutes } from "@/lib/utils/dtr";

const TH = "h-11 px-3 text-theme-xs font-medium text-muted-foreground whitespace-nowrap";
const TD = "px-3 py-2 tabular-nums";

function useDtrRows(window: DayWindow) {
  const [state, setState] = React.useState<{ key: string; rows: DtrReportRow[]; error: string | null } | null>(null);
  const key = `${window.from}|${window.to}`;
  React.useEffect(() => {
    let live = true;
    void dtrReportData(window.from, window.to).then((r) => {
      if (!live) return;
      setState("error" in r ? { key, rows: [], error: r.error } : { key, rows: r.rows, error: null });
    });
    return () => {
      live = false;
    };
  }, [window.from, window.to, key]);
  return state?.key === key ? { ...state, loading: false } : { rows: [] as DtrReportRow[], error: null, loading: true };
}

/**
 * HR > Reports > DTR Report (Nov 2026): one row per employee with a login for a week, a month, a
 * year or two dates -- days, punches, hours, late, undertime, overtime, missed clock-outs,
 * absences, leave -- compared with the range before. CSV, the branded PDF and the AI's comparison.
 */
export function DtrReportSection({ today }: { today: string }) {
  const [period, setPeriod] = React.useState<PeriodState>({ kind: "month", anchor: today });
  const window = periodStateWindow(period);
  const prevWindow = previousWindow(period.kind, window);
  const { rows, error, loading } = useDtrRows(window);
  const previous = useDtrRows(prevWindow);
  const ai = useReportAnalysis();
  const clearAnalysis = ai.clear;
  React.useEffect(() => clearAnalysis(), [window.from, window.to, clearAnalysis]);
  const label = periodLabel(period.kind, window);
  const prevLabel = periodLabel(period.kind, prevWindow);
  const t = dtrTotals(rows);
  const p = dtrTotals(previous.rows);
  const report = () => dtrReport({ rows, previous: previous.rows, period: label, previousPeriod: prevLabel });
  const delta = (cur: number, prev: number) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : undefined);

  return (
    <SectionCard
      title="DTR Report"
      description="Every employee with a login: punches, hours, late, undertime, overtime, missed clock-outs, absences and leave for the range, judged like the timesheets."
      actions={
        <Button variant="outline" size="sm" disabled={loading || !rows.length} onClick={() => downloadCsv(dtrReportCsv(rows), `dtr-report-${window.from}-${window.to}.csv`)}>
          <Download className="size-3.5" /> CSV
        </Button>
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodPicker value={period} onChange={setPeriod} kinds={["week", "month", "quarter", "year", "custom"]} />
        <ReportToolbar ai={ai} buildSpec={() => report().spec} buildInput={() => report().input} filename={`LAF-DTR-Report-${window.from}-${window.to}.pdf`} />
      </div>
      <KpiGrid>
        <KpiCard label="Hours worked" value={hours(t.workedMinutes).toLocaleString()} sublabel={`${prevLabel}: ${hours(p.workedMinutes).toLocaleString()}`} deltaPct={delta(t.workedMinutes, p.workedMinutes)} deltaLabel={`vs ${prevLabel}`} />
        <KpiCard label="Late arrivals" value={t.lateDays} sublabel={`${formatMinutes(t.lateMinutes)} in all · ${prevLabel}: ${p.lateDays}`} deltaPct={delta(t.lateDays, p.lateDays)} deltaLabel={`vs ${prevLabel}`} />
        <KpiCard label="Missed clock-outs" value={t.missedPunches} sublabel={`${prevLabel}: ${p.missedPunches}`} deltaPct={delta(t.missedPunches, p.missedPunches)} deltaLabel={`vs ${prevLabel}`} />
        <KpiCard label="Absences" value={t.absences} sublabel={`${t.leaveDays} leave days · ${prevLabel}: ${p.absences}`} deltaPct={delta(t.absences, p.absences)} deltaLabel={`vs ${prevLabel}`} />
      </KpiGrid>
      <AiAnalysisPanel text={ai.analysis?.overall} />
      {error ? <p className="text-theme-sm text-destructive">{error}</p> : null}
      {loading ? (
        <p className="text-theme-sm text-muted-foreground">Judging the punches…</p>
      ) : rows.length === 0 ? (
        <p className="text-theme-sm text-muted-foreground">No employee is linked to a login yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {DTR_COLUMNS.map((c, i) => (
                  <TableHead key={c} className={`${TH} ${i >= 2 ? "text-right" : ""}`}>
                    {c}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.employeeId}>
                  <TableCell className={`${TD} whitespace-nowrap font-medium`}>
                    <Link href={`/staff/dtr/print/${r.staffId}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
                      {r.name}
                    </Link>
                  </TableCell>
                  <TableCell className={`${TD} whitespace-nowrap text-muted-foreground`}>{r.position}</TableCell>
                  {[r.scheduledDays, r.daysWorked, r.punchesIn, r.punchesOut, hours(r.workedMinutes), r.lateDays, r.lateMinutes, r.undertimeMinutes, r.overtimeMinutes, r.missedPunches, r.absences, r.leaveDays].map((v, i) => (
                    <TableCell key={i} className={`${TD} text-right ${(i === 5 || i === 6 || i === 9 || i === 10) && v > 0 ? "text-destructive" : ""}`}>
                      {v.toLocaleString()}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
              <TableRow className="font-semibold">
                <TableCell className={TD}>Total</TableCell>
                <TableCell className={`${TD} text-muted-foreground`}>{t.employees} employees</TableCell>
                {[t.scheduledDays, t.daysWorked, t.punchesIn, t.punchesOut, hours(t.workedMinutes), t.lateDays, t.lateMinutes, t.undertimeMinutes, t.overtimeMinutes, t.missedPunches, t.absences, t.leaveDays].map((v, i) => (
                  <TableCell key={i} className={`${TD} text-right`}>
                    {v.toLocaleString()}
                  </TableCell>
                ))}
              </TableRow>
            </TableBody>
          </Table>
          <AiAnalysisPanel text={ai.analysis?.sections.Attendance} compact />
          <p className="mt-2 text-theme-xs text-muted-foreground">Tap a name for that person&apos;s printed DTR. Hours are gross clocked time; late, undertime and overtime follow the employee&apos;s schedule and the grace minutes in Settings.</p>
        </div>
      )}
    </SectionCard>
  );
}
