"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Calculator, ArrowRight, Wallet } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/empty-state";
import { StatusBadge } from "@/components/patterns/status-badge";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { SectionCard } from "@/components/patterns/section-card";
import { LoadingState } from "@/components/patterns/loading-state";
import { Button } from "@/components/ui/button";
import { HrSubNav } from "@/components/modules/hr/hr-subnav";
import { PayItemsCard } from "@/components/modules/hr/pay-items-card";
import { YtdOpeningsCard } from "@/components/modules/hr/ytd-openings-card";
import { YearEndCard } from "@/components/modules/hr/year-end-card";
import { usePayPeriods, payPeriodsStore } from "@/lib/hooks/use-pay-periods-collection";
import { usePayrollRuns, payrollRunsStore } from "@/lib/hooks/use-payroll-collections";
import { useEmployees } from "@/lib/hooks/use-employees-collection";
import { useNow } from "@/lib/hooks/use-now";
import { useRole } from "@/lib/rbac/use-role";
import { canManageHr } from "@/lib/rbac/roles";
import { dayKey } from "@/lib/utils/dtr";
import { formatDate } from "@/lib/utils/date";
import { formatAmount2, toCentavos } from "@/lib/utils/money";
import { payPeriodLabel } from "@/lib/utils/pay-period";
import { computeRegularRun } from "./actions";
import { PAYROLL_RUN_KINDS, type PayPeriod, type PayrollRun } from "@/lib/types/hr";

/**
 * Payroll: each period's run from timesheets-approved to paid, the pay
 * items that ride on payslips, and the year's opening figures. The run
 * itself lives at /hr/payroll/[runId].
 */
export default function PayrollPage() {
  const { role, isHr } = useRole();
  const manages = canManageHr(role, isHr);
  const { periods, loading: periodsLoading } = usePayPeriods();
  const { runs, loading: runsLoading } = usePayrollRuns();
  const { employees } = useEmployees();
  const today = dayKey(useNow());
  const [busy, setBusy] = React.useState<string | null>(null);

  if (!manages) return <EmptyState title="HR only" description="Payroll is run by admins and HR. Your payslips are under My Payslips." />;

  const year = Number(today.slice(0, 4));
  const runBy = new Map<string, PayrollRun>();
  for (const r of runs) if (r.kind === "regular" && r.periodId && r.status !== "cancelled") runBy.set(r.periodId, r);
  // Periods worth showing: the year's, most recent first, up to today's plus one ahead.
  const thisYear = periods.filter((p) => p.year === year).sort((a, b) => b.seq - a.seq);
  const readyToCompute = thisYear.filter((p) => p.status === "timesheets_approved");
  const awaitingApproval = runs.filter((r) => r.status === "computed");
  const approvedUnpaid = runs.filter((r) => r.status === "approved");
  const paidThisYear = runs.filter((r) => r.status === "paid" || r.status === "closed").filter((r) => r.year === year);
  const paidNet = paidThisYear.reduce((a, r) => a + toCentavos((r.totals.net as number | undefined) ?? 0), 0);

  async function compute(p: PayPeriod) {
    setBusy(p.id);
    const result = await computeRegularRun(p.id);
    setBusy(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    await Promise.all([payrollRunsStore.refetch(), payPeriodsStore.refetch()]);
    toast.success(`${result.data!.count} payslip(s) computed${result.data!.skipped ? `, ${result.data!.skipped} skipped` : ""}.`);
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="Payroll" description="Compute from approved timesheets, have a second person approve, pay by bank transfer, record the reference." action={<HrSubNav />} />
      {role === "admin" || role === "finance" ? (
        <div className="flex justify-end">
          <Button asChild size="sm" variant="ghost">
            <Link href="/hr/payroll/reconcile">Bank reconciliation</Link>
          </Button>
        </div>
      ) : null}

      <KpiGrid>
        <KpiCard label="Ready to compute" value={periodsLoading ? "…" : readyToCompute.length} icon={Calculator} sublabel="Periods with every timesheet approved" />
        <KpiCard label="Awaiting approval" value={runsLoading ? "…" : awaitingApproval.length} icon={Wallet} tone="warning" sublabel="Computed, needs a second person" />
        <KpiCard label="Approved, unpaid" value={runsLoading ? "…" : approvedUnpaid.length} icon={Wallet} sublabel="Transfer, then mark paid" />
        <KpiCard label={`Net paid ${year}`} value={runsLoading ? "…" : `₱${formatAmount2(paidNet)}`} icon={Wallet} sublabel={`${paidThisYear.length} run(s) paid`} />
      </KpiGrid>

      <SectionCard title={`Periods ${year}`} flush bodyClassName="flex flex-col divide-y divide-border">
          {periodsLoading ? (
            <div className="p-5">
              <LoadingState />
            </div>
          ) : thisYear.length === 0 ? (
            <p className="px-5 py-3 text-theme-sm text-muted-foreground">
              No periods for {year}.{" "}
              <Link href="/hr/periods" className="underline">
                Generate them
              </Link>
              .
            </p>
          ) : (
            thisYear
              .filter((p) => p.startsOn <= today || p.status !== "open")
              .map((p) => {
                const run = runBy.get(p.id);
                return (
                  <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-theme-sm">
                    <div className="flex min-w-0 flex-col">
                      <span className="font-medium">{payPeriodLabel({ year: p.year, seq: p.seq, from: p.startsOn, to: p.endsOn, isSecondCutoff: p.seq % 2 === 0 })}</span>
                      <span className="text-theme-xs text-muted-foreground">
                        Pay date {formatDate(p.payDate)}
                        {run?.totals.net !== undefined ? ` · net ₱${formatAmount2(toCentavos(run.totals.net as number))} for ${String(run.totals.count ?? "")}` : ""}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge dot domain="payPeriod" status={p.status} />
                      {run ? (
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/hr/payroll/${run.id}`}>
                            Open run
                            <ArrowRight />
                          </Link>
                        </Button>
                      ) : p.status === "timesheets_approved" ? (
                        <Button size="sm" className="gap-1.5" onClick={() => compute(p)} disabled={busy !== null}>
                          <Calculator className="size-3.5" />
                          {busy === p.id ? "Computing…" : "Compute"}
                        </Button>
                      ) : p.status === "open" ? (
                        <Button asChild size="sm" variant="ghost">
                          <Link href={`/hr/timesheets?period=${p.id}`}>Timesheets</Link>
                        </Button>
                      ) : null}
                    </div>
                  </div>
                );
              })
          )}
      </SectionCard>

      {runs.some((r) => r.kind !== "regular" || r.status === "cancelled") ? (
        <SectionCard title="Other runs" flush bodyClassName="flex flex-col divide-y divide-border">
            {runs
              .filter((r) => r.kind !== "regular" || r.status === "cancelled")
              .map((r) => (
                <Link key={r.id} href={`/hr/payroll/${r.id}`} className="flex items-center justify-between gap-2 px-5 py-3 text-theme-sm hover:bg-muted/60">
                  <span>
                    {PAYROLL_RUN_KINDS[r.kind]} {r.label ?? r.year}
                  </span>
                  <StatusBadge dot domain="payrollRun" status={r.status} />
                </Link>
              ))}
        </SectionCard>
      ) : null}

      <YearEndCard employees={employees} periods={periods} runs={runs} year={year} today={today} />
      <PayItemsCard employees={employees} periods={periods} />
      <YtdOpeningsCard employees={employees} year={year} />
    </div>
  );
}
