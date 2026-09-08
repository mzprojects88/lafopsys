"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Printer, Check } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/empty-state";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { HrSubNav } from "@/components/modules/hr/hr-subnav";
import { usePayslips, myPayslipsStore } from "@/lib/hooks/use-payroll-collections";
import { useEmployees } from "@/lib/hooks/use-employees-collection";
import { usePayPeriods } from "@/lib/hooks/use-pay-periods-collection";
import { useRole } from "@/lib/rbac/use-role";
import { formatDate } from "@/lib/utils/date";
import { formatAmount2, toCentavos } from "@/lib/utils/money";
import { payPeriodLabel } from "@/lib/utils/pay-period";
import { acknowledgePayslip } from "../payroll/actions";

/**
 * My Payslips: the caller's own, newest first, once the run is approved.
 * Acknowledging is the one write an employee has on payroll. HR sees
 * everyone's payslips through RLS, so this page shows only their own.
 */
export default function MyPayslipsPage() {
  const { staffId } = useRole();
  const { payslips, loading } = usePayslips();
  const { employees } = useEmployees();
  const { periods } = usePayPeriods();
  const [busy, setBusy] = React.useState<string | null>(null);

  const me = employees.find((e) => e.staffId === staffId) ?? null;
  const mine = me ? payslips.filter((p) => p.employeeId === me.id) : [];
  const periodBy = new Map(periods.map((p) => [p.id, p]));

  async function acknowledge(id: string) {
    setBusy(id);
    const r = await acknowledgePayslip(id);
    setBusy(null);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    await myPayslipsStore.refetch();
    toast.success("Acknowledged.");
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="My Payslips" description="Each pay period's payslip once payroll has been approved. Open one to print or save it." action={<HrSubNav />} />
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !me ? (
        <EmptyState title="No employee record linked to your login" description="HR links your 201 record to this account; your payslips appear here after that." />
      ) : mine.length === 0 ? (
        <EmptyState title="No payslips yet" description="The first one appears when HR approves a payroll run that includes you." />
      ) : (
        <div className="flex flex-col gap-3">
          {mine.map((p) => {
            const period = p.periodId ? periodBy.get(p.periodId) : null;
            return (
              <Card key={p.id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
                  <div className="flex min-w-0 flex-col">
                    <span className="font-medium">{period ? payPeriodLabel({ year: period.year, seq: period.seq, from: period.startsOn, to: period.endsOn, isSecondCutoff: period.seq % 2 === 0 }) : formatDate(p.payDate)}</span>
                    <span className="text-xs text-muted-foreground">
                      Pay date {formatDate(p.payDate)} · gross ₱{formatAmount2(toCentavos(p.gross))} · deductions ₱{formatAmount2(toCentavos(p.totalDeductions))}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-lg font-bold tabular-nums">₱{formatAmount2(toCentavos(p.net))}</span>
                    <StatusBadge domain="payslip" status={p.acknowledgedAt ? "acknowledged" : "unacknowledged"} label={p.acknowledgedAt ? `Seen ${formatDate(p.acknowledgedAt, "MMM d")}` : "Not yet seen"} />
                    <Button asChild size="sm" variant="outline" className="gap-1.5">
                      <Link href={`/hr/payslips/${p.id}/print`} target="_blank">
                        <Printer className="size-3.5" />
                        Open
                      </Link>
                    </Button>
                    {!p.acknowledgedAt ? (
                      <Button size="sm" className="gap-1.5" onClick={() => acknowledge(p.id)} disabled={busy !== null}>
                        <Check className="size-3.5" />
                        {busy === p.id ? "…" : "Acknowledge"}
                      </Button>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
