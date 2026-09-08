"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Download, RefreshCw, Check, RotateCcw } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/empty-state";
import { StatusBadge } from "@/components/patterns/status-badge";
import { ReasonDialog } from "@/components/patterns/reason-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HrSubNav } from "@/components/modules/hr/hr-subnav";
import { TimesheetSummaryTable, PREMIUM_LABEL } from "@/components/modules/hr/timesheet-summary-table";
import { useEmployees } from "@/lib/hooks/use-employees-collection";
import { usePayPeriods, usePeriodTimesheets, periodTimesheetsFamily, payPeriodsStore } from "@/lib/hooks/use-pay-periods-collection";
import { useNow } from "@/lib/hooks/use-now";
import { useRole } from "@/lib/rbac/use-role";
import { canManageHr } from "@/lib/rbac/roles";
import { dayKey } from "@/lib/utils/dtr";
import { csvLines, downloadCsv } from "@/lib/utils/csv";
import { formatDate } from "@/lib/utils/date";
import { payPeriodKey, payPeriodLabel } from "@/lib/utils/pay-period";
import { PREMIUM_CLASSES } from "@/lib/utils/attendance";
import { computePeriodTimesheet, markPeriodTimesheetsApproved, reopenPeriodTimesheet } from "../periods/actions";
import { employeeFullName, type Employee, type PeriodTimesheet } from "@/lib/types/hr";

/**
 * Timesheets per pay period: each employee's attendance summary computed
 * from the live DTR, approved by HR, and frozen for payroll. Replaces
 * /staff/payroll-export (hours only, monthly) with the semi-monthly
 * summary payroll actually needs.
 */
export default function TimesheetsPage() {
  return (
    <React.Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
      <TimesheetsInner />
    </React.Suspense>
  );
}

function TimesheetsInner() {
  const params = useSearchParams();
  const { role, isHr } = useRole();
  const manages = canManageHr(role, isHr);
  const { periods, loading: periodsLoading } = usePayPeriods();
  const { employees } = useEmployees();
  const today = dayKey(useNow());
  const [periodId, setPeriodId] = React.useState<string | null>(params.get("period"));
  const period = periods.find((p) => p.id === periodId) ?? (periodId === null ? (periods.find((p) => p.startsOn <= today && p.endsOn >= today) ?? periods[0]) : undefined) ?? null;
  const { timesheets, loading } = usePeriodTimesheets(period?.id ?? null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [reopening, setReopening] = React.useState<PeriodTimesheet | null>(null);

  if (!manages) return <EmptyState title="HR only" description="Timesheets are reviewed by admins and HR." />;

  const due = period
    ? employees.filter((e) => e.hireDate <= period.endsOn && (e.separationDate === null || e.separationDate >= period.startsOn) && e.status !== "terminated")
    : [];
  const byEmployee = new Map(timesheets.map((t) => [t.employeeId, t]));
  const approvedCount = due.filter((e) => byEmployee.get(e.id)?.status === "approved").length;
  const frozen = period ? period.status !== "open" && period.status !== "timesheets_approved" : true;

  async function compute(e: Employee, approve: boolean) {
    if (!period) return;
    setBusy(e.id);
    const result = await computePeriodTimesheet(period.id, e.id, { approve });
    setBusy(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    await periodTimesheetsFamily.get(period.id).refetch();
    toast.success(approve ? `${e.firstName}'s timesheet approved.` : `${e.firstName}'s timesheet recomputed.`);
  }

  async function computeAll() {
    if (!period) return;
    setBusy("all");
    let ok = 0;
    for (const e of due) {
      if (byEmployee.get(e.id)?.status === "approved") continue;
      const r = await computePeriodTimesheet(period.id, e.id, { approve: false });
      if (r.ok) ok++;
      else toast.error(`${employeeFullName(e)}: ${r.error}`);
    }
    setBusy(null);
    await periodTimesheetsFamily.get(period.id).refetch();
    toast.success(`${ok} timesheet(s) computed.`);
  }

  async function markPeriod() {
    if (!period) return;
    setBusy("period");
    const result = await markPeriodTimesheetsApproved(period.id);
    setBusy(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    await payPeriodsStore.refetch();
    toast.success("Period marked: timesheets approved. Payroll can be computed.");
  }

  async function reopen(reason: string) {
    if (!reopening || !period) return;
    const result = await reopenPeriodTimesheet(reopening.id, reason);
    setReopening(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    await Promise.all([periodTimesheetsFamily.get(period.id).refetch(), payPeriodsStore.refetch()]);
    toast.success("Timesheet reopened.");
  }

  function exportCsv() {
    if (!period) return;
    const header = ["Employee ID", "Employee", "Status", "Scheduled days", "Days worked", "Absences", "Paid leave", "Unpaid leave", "Late (min)", "Undertime (min)", "Regular holidays unworked", "Missed punches"];
    for (const c of PREMIUM_CLASSES) header.push(`${PREMIUM_LABEL[c]} regular (min)`, `${PREMIUM_LABEL[c]} OT (min)`, `${PREMIUM_LABEL[c]} night (min)`, `${PREMIUM_LABEL[c]} night OT (min)`);
    const rows = due.map((e) => {
      const ts = byEmployee.get(e.id);
      const t = ts?.summary?.totals;
      const row = [e.employeeCode, employeeFullName(e), ts?.status ?? "not computed"];
      if (!t) return [...row, ...Array(header.length - 3).fill("")];
      row.push(String(t.scheduledDays), String(t.daysWorked), String(t.absences), String(t.paidLeaveDays), String(t.unpaidLeaveDays), String(t.lateMinutes), String(t.undertimeMinutes), String(t.regularHolidaysUnworked), String(t.missedPunches));
      for (const c of PREMIUM_CLASSES) {
        const b = t.byPremium[c];
        row.push(String(b.minutes), String(b.overtimeMinutes), String(b.nightMinutes), String(b.nightOvertimeMinutes));
      }
      return row;
    });
    downloadCsv(csvLines(header, rows), `timesheets-${payPeriodKey(period)}.csv`);
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="Timesheets" description="Each person's attendance for the period, computed from the DTR and approved before payroll reads it." action={<HrSubNav />} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Select value={period?.id ?? ""} onValueChange={setPeriodId}>
          <SelectTrigger className="w-64" aria-label="Pay period">
            <SelectValue placeholder={periodsLoading ? "Loading…" : "No periods yet"} />
          </SelectTrigger>
          <SelectContent>
            {periods.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {payPeriodLabel({ year: p.year, seq: p.seq, from: p.startsOn, to: p.endsOn, isSecondCutoff: p.seq % 2 === 0 })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {period ? (
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge dot domain="payPeriod" status={period.status} />
            <span className="text-xs text-muted-foreground">
              {approvedCount}/{due.length} approved · pay date {formatDate(period.payDate)}
            </span>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={computeAll} disabled={busy !== null || frozen}>
              <RefreshCw className="size-3.5" />
              {busy === "all" ? "Computing…" : "Compute all"}
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={exportCsv} disabled={timesheets.length === 0}>
              <Download className="size-3.5" />
              CSV
            </Button>
            <Button size="sm" className="gap-1.5" onClick={markPeriod} disabled={busy !== null || period.status !== "open" || approvedCount < due.length || due.length === 0}>
              <Check className="size-3.5" />
              Mark period approved
            </Button>
          </div>
        ) : null}
      </div>

      {!period ? (
        <EmptyState title="No pay period" description="Generate the year's periods under Pay Periods first." />
      ) : due.length === 0 ? (
        <EmptyState title="Nobody employed in this period" description="Employees with a hire date on or before the cutoff appear here." />
      ) : (
        <div className="flex flex-col gap-3">
          {due.map((e) => {
            const ts = byEmployee.get(e.id);
            const summary = ts?.summary ?? null;
            return (
              <Card key={e.id}>
                <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
                  <CardTitle className="text-base">
                    {employeeFullName(e)}
                    <span className="text-xs font-normal text-muted-foreground"> · {e.position}{e.staffId ? "" : " · no login, no DTR"}</span>
                  </CardTitle>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {ts ? <StatusBadge dot domain="timesheet2" status={ts.status} /> : <StatusBadge domain="timesheet2" status="draft" label="Not computed" />}
                    {ts?.approvedAt ? <span className="text-xs text-muted-foreground">approved {formatDate(ts.approvedAt, "MMM d, HH:mm")}</span> : null}
                    {ts?.status === "approved" ? (
                      <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => setReopening(ts)} disabled={frozen || busy !== null}>
                        <RotateCcw className="size-3.5" />
                        Reopen
                      </Button>
                    ) : (
                      <>
                        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => compute(e, false)} disabled={frozen || busy !== null}>
                          <RefreshCw className="size-3.5" />
                          {busy === e.id ? "…" : summary ? "Recompute" : "Compute"}
                        </Button>
                        <Button size="sm" className="gap-1.5" onClick={() => compute(e, true)} disabled={frozen || busy !== null}>
                          <Check className="size-3.5" />
                          Approve
                        </Button>
                      </>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  {loading && !summary ? (
                    <p className="text-xs text-muted-foreground">Loading…</p>
                  ) : summary ? (
                    <TimesheetSummaryTable summary={summary} />
                  ) : (
                    <p className="text-xs text-muted-foreground">Not computed yet. Compute reads the DTR, the schedule, the holidays and approved leave; Approve freezes the result for payroll.</p>
                  )}
                  {ts?.notes ? <p className="mt-2 whitespace-pre-line text-xs text-muted-foreground">{ts.notes}</p> : null}
                  {summary && summary.totals.missedPunches > 0 ? (
                    <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                      {summary.totals.missedPunches} missed clock-out(s) — those sessions count for nothing. Close them from Staff &amp; Time → Timesheets, then recompute.
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <ReasonDialog
        open={reopening !== null}
        onOpenChange={(open) => (open ? undefined : setReopening(null))}
        title="Reopen this timesheet?"
        description="Its approval is withdrawn so it can be recomputed after a DTR correction. Say why — the reason stays on the record."
        confirmLabel="Reopen"
        onConfirm={reopen}
      />
    </div>
  );
}
