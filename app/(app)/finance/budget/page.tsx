"use client";

import * as React from "react";
import { toast } from "sonner";
import { Copy, Download } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { SectionCard } from "@/components/patterns/section-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useBudgetLinesData } from "@/lib/hooks/use-budget-lines-collection";
import { useBankTransactionsData } from "@/lib/hooks/use-bank-transactions-collection";
import { useExpensePurposes } from "@/lib/hooks/use-expense-purposes";
import { useModuleAccess } from "@/lib/hooks/use-module-access";
import { budgetVsActual } from "@/lib/utils/finance-summary";
import { formatCurrency } from "@/lib/utils/currency";
import { downloadCsv } from "@/lib/utils/csv";
import { todayIso } from "@/lib/utils/date";
import { cn } from "@/lib/utils";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const label = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const prevMonth = (m: string) => {
  const y = Number(m.slice(0, 4));
  const mo = Number(m.slice(5, 7));
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`;
};
const nextMonth = (m: string) => {
  const y = Number(m.slice(0, 4));
  const mo = Number(m.slice(5, 7));
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
};

/**
 * Finance › Budget vs Actual (0115): a month's budget per expense purpose, typed by finance,
 * against what the bank paid out with that purpose (Bank import › What the money was spent on).
 */
export default function BudgetPage() {
  const { budgetLines, setBudgets } = useBudgetLinesData();
  const { transactions } = useBankTransactionsData();
  const purposes = useExpensePurposes();
  const canEdit = useModuleAccess().canEdit("finance");
  const thisMonth = todayIso().slice(0, 7);

  // Months with a statement or a budget, plus this month and next (to budget ahead), newest first.
  const months = React.useMemo(() => {
    const set = new Set<string>([thisMonth, nextMonth(thisMonth)]);
    for (const t of transactions) set.add(t.postingDate.slice(0, 7));
    for (const b of budgetLines) set.add(b.month);
    return [...set].sort().reverse();
  }, [transactions, budgetLines, thisMonth]);
  const lastStatementMonth = React.useMemo(() => transactions.reduce((m, t) => (t.postingDate > m ? t.postingDate : m), "").slice(0, 7), [transactions]);
  const [month, setMonth] = React.useState<string | null>(null);
  const shown = month ?? (lastStatementMonth || thisMonth);

  const rows = React.useMemo(() => budgetVsActual(purposes, budgetLines, transactions, shown), [purposes, budgetLines, transactions, shown]);
  const totalBudget = rows.reduce((s, r) => s + (r.budgeted ?? 0), 0);
  const totalActual = rows.reduce((s, r) => s + r.actual, 0);
  const noStatement = !transactions.some((t) => t.postingDate.startsWith(shown));
  const previous = budgetLines.filter((b) => b.month === prevMonth(shown) && b.purpose);

  async function saveOne(purpose: string, value: string) {
    const amount = value.trim() === "" ? 0 : Number(value);
    if (!Number.isFinite(amount) || amount < 0) return void toast.error("Enter an amount of zero or more.");
    const r = await setBudgets(shown, { [purpose]: Math.round(amount * 100) / 100 });
    if (!r.ok) toast.error(r.error);
  }

  async function copyPrevious() {
    const r = await setBudgets(shown, Object.fromEntries(previous.map((b) => [b.purpose as string, b.budgeted])));
    if (!r.ok) return void toast.error(r.error);
    toast.success(`Copied ${label(prevMonth(shown))}'s budget`);
  }

  function csv() {
    downloadCsv(
      [["Purpose", "Budget", "Actual", "Left"], ...rows.map((r) => [r.purpose, r.budgeted ?? "", r.actual, r.budgeted === null ? "" : Math.round((r.budgeted - r.actual) * 100) / 100]), ["Total", totalBudget, totalActual, Math.round((totalBudget - totalActual) * 100) / 100]]
        .map((line) => line.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
        .join("\n"),
      `budget-vs-actual-${shown}.csv`
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="Budget vs Actual" description="A month's budget per expense purpose, against what the bank paid out with that purpose." />
      <SectionCard
        flush
        className="overflow-hidden"
        title={label(shown)}
        description={noStatement ? "No bank statement covers this month yet, so the actuals are zero until it is uploaded (Financial › Bank import)." : "Actuals are the month's bank debits by the purpose confirmed or suggested on Bank import; transfers between LAF's own accounts are left out."}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canEdit && previous.length > 0 ? (
              <Button size="sm" variant="outline" onClick={copyPrevious}>
                <Copy /> Copy {MONTHS[Number(prevMonth(shown).slice(5, 7)) - 1]}
              </Button>
            ) : null}
            <Button size="sm" variant="outline" onClick={csv}>
              <Download /> CSV
            </Button>
            <Select value={shown} onValueChange={setMonth}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {months.map((m) => (
                  <SelectItem key={m} value={m}>
                    {label(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-theme-sm">
            <thead>
              <tr className="border-b border-border text-left text-theme-xs text-muted-foreground">
                <th className="h-10 px-5 font-medium">Purpose</th>
                <th className="h-10 px-5 text-right font-medium">Budget</th>
                <th className="h-10 px-5 text-right font-medium">Actual</th>
                <th className="h-10 px-5 font-medium">Used</th>
                <th className="h-10 px-5 text-right font-medium">Left</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const pct = r.budgeted ? Math.round((r.actual / r.budgeted) * 100) : null;
                const left = r.budgeted === null ? null : r.budgeted - r.actual;
                const untagged = r.purpose === "Not yet tagged";
                return (
                  <tr key={r.purpose} className={cn("border-b border-border", untagged && "text-muted-foreground")}>
                    <td className="px-5 py-2.5 font-medium">{r.purpose}</td>
                    <td className="px-5 py-2 text-right">
                      {canEdit && !untagged ? (
                        <Input
                          key={`${shown}-${r.purpose}-${r.budgeted}`}
                          aria-label={`Budget for ${r.purpose}`}
                          type="number"
                          inputMode="decimal"
                          min={0}
                          defaultValue={r.budgeted ?? ""}
                          placeholder="—"
                          className="ml-auto h-8 w-32 text-right tabular-nums"
                          onBlur={(e) => e.target.value !== String(r.budgeted ?? "") && void saveOne(r.purpose, e.target.value)}
                        />
                      ) : (
                        <span className="tabular-nums">{r.budgeted === null ? "—" : formatCurrency(r.budgeted)}</span>
                      )}
                    </td>
                    <td className="px-5 py-2.5 text-right tabular-nums">{formatCurrency(r.actual)}</td>
                    <td className="px-5 py-2.5">
                      {pct === null ? (
                        <span className="text-theme-xs text-muted-foreground">{untagged ? "Tag on Bank import" : "No budget"}</span>
                      ) : (
                        <div className="flex w-36 items-center gap-2">
                          <Progress value={Math.min(100, pct)} className={cn("h-1.5", pct > 100 && "[&>div]:bg-destructive")} />
                          <span className={cn("w-12 text-theme-xs tabular-nums", pct > 100 && "text-destructive")}>{pct}%</span>
                        </div>
                      )}
                    </td>
                    <td className={cn("px-5 py-2.5 text-right tabular-nums", left !== null && left < 0 && "text-destructive")}>{left === null ? "—" : formatCurrency(left)}</td>
                  </tr>
                );
              })}
              <tr className="bg-muted/40 font-semibold">
                <td className="px-5 py-3">Total</td>
                <td className="px-5 py-3 text-right tabular-nums">{formatCurrency(totalBudget)}</td>
                <td className="px-5 py-3 text-right tabular-nums">{formatCurrency(totalActual)}</td>
                <td className="px-5 py-3 text-theme-xs font-normal text-muted-foreground">{totalBudget > 0 ? `${Math.round((totalActual / totalBudget) * 100)}% of the budget` : ""}</td>
                <td className={cn("px-5 py-3 text-right tabular-nums", totalBudget - totalActual < 0 && "text-destructive")}>{totalBudget > 0 ? formatCurrency(totalBudget - totalActual) : "—"}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
