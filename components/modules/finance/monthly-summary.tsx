"use client";

import * as React from "react";
import { toast } from "sonner";
import { Landmark, Pencil } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/patterns/empty-state";
import { useBankTransactionsData } from "@/lib/hooks/use-bank-transactions-collection";
import { useCashEntriesData } from "@/lib/hooks/use-cash-entries-collection";
import { useFinanceMonthNotes } from "@/lib/hooks/use-finance-month-notes-collection";
import { useNow } from "@/lib/hooks/use-now";
import { useRole } from "@/lib/rbac/use-role";
import { dayKey } from "@/lib/utils/dtr";
import { formatDate } from "@/lib/utils/date";
import { availableYears, cashInBank, donorBreakdown, monthlySummary, monthsWithReceipts, type MonthRow } from "@/lib/utils/finance-summary";
import { cn } from "@/lib/utils";

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Centavos matter on a summary the CEO reads against the bank statement. */
const peso = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (n: number | null) => (n === null ? "—" : peso.format(n));
const pct = (n: number | null) => (n === null ? "—" : `${(n * 100).toFixed(2)}%`);
const monthLabel = (m: string) => `${MONTH_NAMES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

/**
 * The CEO's "Income and Expenses Tracking" sheet, from the ledgers.
 *
 * Expenses, Donation, Net, % and Cash in Bank come from ops.bank_transactions
 * -- cleared money, as the bank saw it. The donor breakdown comes from
 * ops.cash_entries -- who gave. The two are never added together; see
 * migration 0033 for why. lib/utils/finance-summary.ts is the arithmetic.
 */
export function MonthlySummary({ compact = false }: { compact?: boolean }) {
  const { transactions, loading: txnsLoading, error: txnsError } = useBankTransactionsData();
  const { entries } = useCashEntriesData();
  const { notes, upsertNote } = useFinanceMonthNotes();
  const { role } = useRole();
  const canWriteNotes = role === "admin" || role === "finance";
  const today = dayKey(useNow());
  const currentYear = Number(today.slice(0, 4));

  const years = React.useMemo(() => availableYears(transactions, currentYear), [transactions, currentYear]);
  const [year, setYear] = React.useState<number | null>(null);
  const shownYear = year ?? (years.includes(currentYear) && transactions.some((t) => t.postingDate.startsWith(String(currentYear))) ? currentYear : years[0]);

  const summary = React.useMemo(() => monthlySummary(transactions, shownYear, notes), [transactions, shownYear, notes]);
  const bank = React.useMemo(() => cashInBank(transactions), [transactions]);

  const receipts = React.useMemo(
    () =>
      entries.map((e) => ({
        id: e.id,
        date: e.date || null,
        amount: e.amount,
        direction: e.direction,
        donorName: e.donorName ?? null,
        sourceSheet: e.sourceSheet ?? null,
        approvalStatus: e.approvalStatus,
        duplicateOfId: e.duplicateOfId ?? null,
      })),
    [entries]
  );
  const receiptMonths = React.useMemo(() => monthsWithReceipts(receipts), [receipts]);
  const [donorMonth, setDonorMonth] = React.useState<string | null>(null);
  const shownDonorMonth = donorMonth ?? receiptMonths[0] ?? null;
  const donors = React.useMemo(() => (shownDonorMonth ? donorBreakdown(receipts, shownDonorMonth) : []), [receipts, shownDonorMonth]);
  const donorTotal = donors.reduce((s, d) => s + d.amount, 0);

  if (txnsError) return <EmptyState title="Couldn't load the bank record" description={txnsError} />;

  const visibleRows = compact ? summary.rows.filter((r) => r.hasData) : summary.rows;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <div className="flex flex-col gap-0.5">
            <CardTitle className="text-base">Financial support</CardTitle>
            <span className="text-xs text-muted-foreground">
              Expenses and donations as they cleared the bank. Interest the bank paid is not counted as a donation.
            </span>
          </div>
          <Select value={String(shownYear)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {txnsLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : summary.total.monthsWithData === 0 ? (
            <EmptyState
              icon={Landmark}
              title={`No bank statement covers ${shownYear} yet`}
              description="Upload the month's statement under Financial → Bank import and this fills in."
              className="py-6"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Month</th>
                    <th className="py-2 pr-3 text-right font-medium">Expenses</th>
                    <th className="py-2 pr-3 text-right font-medium">Donation</th>
                    <th className="py-2 pr-3 text-right font-medium">Net donation</th>
                    <th className="py-2 pr-3 text-right font-medium">% of donation spent</th>
                    <th className="py-2 font-medium">Key monthly drivers</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row) => (
                    <SummaryRow key={row.month} row={row} canWriteNotes={canWriteNotes} onSave={(text) => upsertNote(row.month, text)} />
                  ))}
                  <tr className="border-t-2 font-semibold">
                    <td className="py-2 pr-3">Total</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{money(summary.total.expenses)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{money(summary.total.donation)}</td>
                    <td className={cn("py-2 pr-3 text-right tabular-nums", summary.total.net < 0 && "text-rose-600 dark:text-rose-400")}>{money(summary.total.net)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{pct(summary.total.pctSpent)}</td>
                    <td className="py-2 text-xs font-normal text-muted-foreground">
                      {summary.total.monthsWithData} of 12 months have a statement
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {bank ? (
            <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border bg-muted/30 px-4 py-3">
              <span className="text-sm font-medium">Cash in bank as of {formatDate(bank.asOf, "MMMM d, yyyy")}</span>
              <span className="text-lg font-bold tabular-nums">{peso.format(bank.amount)}</span>
              <span className="w-full text-xs text-muted-foreground">
                The closing balance on the last imported statement line — the bank&apos;s figure, not one worked out from the columns above.
              </span>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {!compact || donors.length > 0 ? (
        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
            <div className="flex flex-col gap-0.5">
              <CardTitle className="text-base">Breakdown of monthly donors</CardTitle>
              <span className="text-xs text-muted-foreground">Donor-attributed receipts. Gifts logged on more than one sheet are shown once.</span>
            </div>
            {receiptMonths.length > 0 ? (
              <Select value={shownDonorMonth ?? ""} onValueChange={setDonorMonth}>
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {receiptMonths.map((m) => (
                    <SelectItem key={m} value={m}>
                      {monthLabel(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
          </CardHeader>
          <CardContent>
            {donors.length === 0 ? (
              <p className="text-sm text-muted-foreground">No donor-attributed receipts for this month.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[420px] text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="py-2 pr-3 font-medium">Date</th>
                      <th className="py-2 pr-3 text-right font-medium">Amount</th>
                      <th className="py-2 font-medium">Name</th>
                    </tr>
                  </thead>
                  <tbody>
                    {donors.map((d) => (
                      <tr key={d.id} className="border-b last:border-0">
                        <td className="py-1.5 pr-3 whitespace-nowrap text-muted-foreground">{formatDate(d.date, "MMM d")}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{peso.format(d.amount)}</td>
                        <td className="py-1.5">
                          {d.donorName}
                          {d.duplicates > 0 ? (
                            <span className="pl-1.5 text-[11px] text-muted-foreground" title="Logged on more than one sheet; shown once">
                              ×{d.duplicates + 1} logged
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                    <tr className="font-semibold">
                      <td className="py-2 pr-3">Total</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{peso.format(donorTotal)}</td>
                      <td className="py-2 text-xs font-normal text-muted-foreground">
                        Receipts are logged by the donor&apos;s date and the bank clears on its own, so this will not equal the month&apos;s Donation figure.
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function SummaryRow({ row, canWriteNotes, onSave }: { row: MonthRow; canWriteNotes: boolean; onSave: (text: string) => Promise<{ ok: true } | { ok: false; error: string }> }) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(row.drivers);
  const [saving, setSaving] = React.useState(false);

  async function save() {
    if (draft.trim() === row.drivers.trim()) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const result = await onSave(draft);
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setEditing(false);
  }

  return (
    <tr className={cn("border-b align-top last:border-0", !row.hasData && "text-muted-foreground")}>
      <td className="py-2 pr-3 whitespace-nowrap font-medium">{MONTH_NAMES[row.monthNumber - 1]}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{money(row.expenses)}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{money(row.donation)}</td>
      <td className={cn("py-2 pr-3 text-right tabular-nums", row.net !== null && row.net < 0 && "text-rose-600 dark:text-rose-400")}>{money(row.net)}</td>
      <td className={cn("py-2 pr-3 text-right tabular-nums", row.pctSpent !== null && row.pctSpent > 1 && "text-rose-600 dark:text-rose-400")}>{pct(row.pctSpent)}</td>
      <td className="py-2 text-xs">
        {editing ? (
          <div className="flex flex-col gap-1.5">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={4}
              autoFocus
              disabled={saving}
              placeholder="What drove this month's numbers — the big gifts, the one-off costs, what was advanced and settled later."
            />
            <div className="flex gap-1.5">
              <Button size="sm" onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={saving}
                onClick={() => {
                  setDraft(row.drivers);
                  setEditing(false);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="group flex items-start gap-1.5">
            <span className={cn("max-w-prose", !row.drivers && "italic text-muted-foreground")}>{row.drivers || (row.hasData ? "No summary written yet." : "")}</span>
            {canWriteNotes && row.hasData ? (
              <Button variant="ghost" size="icon-sm" className="shrink-0 opacity-60 group-hover:opacity-100" aria-label={`Edit ${MONTH_NAMES[row.monthNumber - 1]} summary`} onClick={() => setEditing(true)}>
                <Pencil className="size-3.5" />
              </Button>
            ) : null}
          </div>
        )}
      </td>
    </tr>
  );
}
