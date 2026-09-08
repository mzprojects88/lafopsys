"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Link2, Unlink } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HrSubNav } from "@/components/modules/hr/hr-subnav";
import { useYearPayslips, payslipsByYearFamily } from "@/lib/hooks/use-payroll-collections";
import { useBankTransactionsData } from "@/lib/hooks/use-bank-transactions-collection";
import { useEmployees } from "@/lib/hooks/use-employees-collection";
import { useNow } from "@/lib/hooks/use-now";
import { canManageHr } from "@/lib/rbac/roles";
import { useRole } from "@/lib/rbac/use-role";
import { dayKey, addDays } from "@/lib/utils/dtr";
import { formatDate } from "@/lib/utils/date";
import { formatAmount2, toCentavos } from "@/lib/utils/money";
import { linkPayslipBankTransaction } from "../actions";
import { employeeFullName } from "@/lib/types/hr";

const WINDOW_DAYS = 10;

/**
 * Payslip <-> bank statement: every settled payslip of the year against
 * the statement's debits within ten days of the pay date. An exact net
 * match is offered first; HR confirms the link. Admins and finance only,
 * because the statement itself is (0033).
 */
export default function ReconcilePage() {
  const { role, isHr } = useRole();
  const today = dayKey(useNow());
  const [year, setYear] = React.useState(Number(today.slice(0, 4)));
  const { payslips, loading } = useYearPayslips(year);
  const { transactions, loading: bankLoading } = useBankTransactionsData();
  const { employees } = useEmployees();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [choice, setChoice] = React.useState<Record<string, string>>({});

  if (role !== "admin" && role !== "finance") return <EmptyState title="Admins and finance only" description="The bank statement is read by finance; linking payslips to it happens here." />;
  if (!canManageHr(role, isHr)) return <EmptyState title="Needs the HR flag" description="Payslips are visible only to admins and people flagged as HR in Settings, so a finance account needs the flag to reconcile them." />;

  const byEmployee = new Map(employees.map((e) => [e.id, e]));
  const settled = payslips.filter((p) => ["approved", "paid", "closed"].includes(p.runStatus)).sort((a, b) => (a.payDate < b.payDate ? 1 : -1));
  const linkedIds = new Set(settled.map((p) => p.bankTransactionId).filter(Boolean));
  const debits = transactions.filter((t) => t.debit > 0);
  const txBy = new Map(debits.map((t) => [t.id, t]));

  function candidates(payDate: string, net: number) {
    const from = addDays(payDate, -WINDOW_DAYS);
    const to = addDays(payDate, WINDOW_DAYS);
    return debits
      .filter((t) => t.postingDate >= from && t.postingDate <= to && !linkedIds.has(t.id))
      .sort((a, b) => {
        const ea = toCentavos(a.debit) === toCentavos(net) ? 0 : 1;
        const eb = toCentavos(b.debit) === toCentavos(net) ? 0 : 1;
        return ea - eb || Math.abs(a.debit - net) - Math.abs(b.debit - net);
      })
      .slice(0, 8);
  }

  async function link(payslipId: string, txId: string | null) {
    setBusy(payslipId);
    const r = await linkPayslipBankTransaction(payslipId, txId);
    setBusy(null);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    await payslipsByYearFamily.get(String(year)).refetch();
    toast.success(txId ? "Linked." : "Unlinked.");
  }

  const linked = settled.filter((p) => p.bankTransactionId).length;

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="Bank reconciliation" description="Each settled payslip against the statement line that paid it. The statement is imported under Finance." action={<HrSubNav />} />
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild size="sm" variant="ghost" className="gap-1.5">
          <Link href="/hr/payroll">
            <ArrowLeft className="size-3.5" />
            Payroll
          </Link>
        </Button>
        <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
          <SelectTrigger className="w-28" aria-label="Year">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[year - 1, year, year + 1].map((y) => (
              <SelectItem key={y} value={String(y)}>
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">
          {loading || bankLoading ? "Loading…" : `${linked}/${settled.length} linked · statement has ${debits.length} debits`}
        </span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payslips {year}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {settled.length === 0 ? (
            <p className="text-sm text-muted-foreground">No settled payslips in {year}.</p>
          ) : (
            settled.map((p) => {
              const e = byEmployee.get(p.employeeId);
              const tx = p.bankTransactionId ? txBy.get(p.bankTransactionId) : null;
              const options = p.bankTransactionId ? [] : candidates(p.payDate, p.net);
              const exact = options.find((t) => toCentavos(t.debit) === toCentavos(p.net));
              const chosen = choice[p.id] ?? exact?.id ?? "";
              return (
                <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-sm">
                  <div className="flex min-w-0 flex-col">
                    <span className="font-medium">
                      {e ? employeeFullName(e) : p.employeeId} · ₱{formatAmount2(toCentavos(p.net))}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Pay date {formatDate(p.payDate)}
                      {tx ? ` · ${formatDate(tx.postingDate)} ₱${formatAmount2(toCentavos(tx.debit))} ${tx.memo ? `"${tx.memo}"` : tx.description.slice(0, 40)}` : ""}
                    </span>
                  </div>
                  {p.bankTransactionId ? (
                    <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => link(p.id, null)} disabled={busy !== null}>
                      <Unlink className="size-3.5" />
                      Unlink
                    </Button>
                  ) : options.length === 0 ? (
                    <span className="text-xs text-muted-foreground">No statement debit within {WINDOW_DAYS} days. Import the statement first.</span>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Select value={chosen} onValueChange={(v) => setChoice((c) => ({ ...c, [p.id]: v }))}>
                        <SelectTrigger className="w-80" aria-label="Bank line">
                          <SelectValue placeholder="Choose the statement line" />
                        </SelectTrigger>
                        <SelectContent>
                          {options.map((t) => (
                            <SelectItem key={t.id} value={t.id}>
                              {formatDate(t.postingDate, "MMM d")} · ₱{formatAmount2(toCentavos(t.debit))}
                              {toCentavos(t.debit) === toCentavos(p.net) ? " · exact" : ""} · {t.memo ?? t.description.slice(0, 30)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button size="sm" className="gap-1.5" onClick={() => link(p.id, chosen)} disabled={busy !== null || !chosen}>
                        <Link2 className="size-3.5" />
                        Link
                      </Button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
