"use client";

import * as React from "react";
import { toast } from "sonner";
import { Landmark, Pencil, Sparkles } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/patterns/empty-state";
import { LoadingState } from "@/components/patterns/loading-state";
import { SectionCard } from "@/components/patterns/section-card";
import { useBankTransactionsData } from "@/lib/hooks/use-bank-transactions-collection";
import { useCashDepositsData } from "@/lib/hooks/use-cash-deposits-collection";
import { useDonorsData } from "@/lib/hooks/use-donors-collection";
import { useFinanceMonthNotes } from "@/lib/hooks/use-finance-month-notes-collection";
import { useStaffRoster } from "@/lib/hooks/use-staff-roster";
import { useNow } from "@/lib/hooks/use-now";
import { useRole } from "@/lib/rbac/use-role";
import { dayKey } from "@/lib/utils/dtr";
import { formatDate } from "@/lib/utils/date";
import { availableYears, cashInBank, donorBreakdown, monthlySummary, monthsWithReceipts, noteStatus, type MonthNote, type MonthRow, type NoteStatus } from "@/lib/utils/finance-summary";
import { cn } from "@/lib/utils";
import { holdsPower } from "@/lib/rbac/roles";
import { STATUS_TONE_CLASSES } from "@/lib/utils/status-colors";

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Centavos matter on a summary the CEO reads against the bank statement. */
const peso = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (n: number | null) => (n === null ? "—" : peso.format(n));
const pct = (n: number | null) => (n === null ? "—" : `${(n * 100).toFixed(2)}%`);
/** Header cell, as in the inventory tables. */
const TH = "h-11 px-5 text-theme-xs font-medium text-muted-foreground";
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
  const { donors: donorList, donations } = useDonorsData();
  const { deposits } = useCashDepositsData();
  const { notes, drivers, confirm, suggest } = useFinanceMonthNotes();
  const { staff: roster } = useStaffRoster();
  const { roles } = useRole();
  // The CEO, finance, the Office Admin and the Super Admin approve the app's draft (0113).
  const canConfirm = holdsPower(roles, "confirm_summary");
  const nameOf = React.useCallback(
    (id: string) => {
      const s = roster.find((r) => r.id === id);
      return s ? `${s.firstName} ${s.lastName}`.trim() : null;
    },
    [roster]
  );
  const today = dayKey(useNow());
  const currentYear = Number(today.slice(0, 4));

  const years = React.useMemo(() => availableYears(transactions, currentYear), [transactions, currentYear]);
  const [year, setYear] = React.useState<number | null>(null);
  const shownYear = year ?? (years.includes(currentYear) && transactions.some((t) => t.postingDate.startsWith(String(currentYear))) ? currentYear : years[0]);

  // Months before their statement show the tracker's deposits as Donation, provisional (0121).
  const summary = React.useMemo(() => monthlySummary(transactions, shownYear, drivers, { deposits, today }), [transactions, shownYear, drivers, deposits, today]);
  const bank = React.useMemo(() => cashInBank(transactions), [transactions]);

  // Posted cash gifts (Donors > Cash gifts, 0084/0110): one row per gift, named through the donor list.
  const receipts = React.useMemo(() => {
    const nameOf = new Map(donorList.map((d) => [d.id, d.name]));
    return donations
      .filter((d) => d.kind === "cash")
      .map((d) => ({ id: d.id, date: d.date, amount: d.totalValue, direction: "inflow" as const, donorName: nameOf.get(d.donorId) ?? "Donor on file", sourceSheet: null, approvalStatus: "approved", duplicateOfId: null }));
  }, [donations, donorList]);
  // Months with a posted gift or a deposit, newest first.
  const receiptMonths = React.useMemo(() => [...new Set([...monthsWithReceipts(receipts), ...deposits.map((d) => d.date.slice(0, 7))])].sort().reverse(), [receipts, deposits]);
  const [donorMonth, setDonorMonth] = React.useState<string | null>(null);
  const shownDonorMonth = donorMonth ?? receiptMonths[0] ?? null;
  const donors = React.useMemo(() => (shownDonorMonth ? donorBreakdown(receipts, shownDonorMonth) : []), [receipts, shownDonorMonth]);
  const donorTotal = donors.reduce((s, d) => s + d.amount, 0);
  const depositTotal = shownDonorMonth ? deposits.filter((d) => d.date.startsWith(shownDonorMonth)).reduce((s, d) => s + d.amount, 0) : 0;
  const lastStatement = transactions.length ? transactions.reduce((m, t) => (t.postingDate > m ? t.postingDate : m), "") : null;
  const statementStale = lastStatement !== null && (Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10))) - Date.UTC(Number(lastStatement.slice(0, 4)), Number(lastStatement.slice(5, 7)) - 1, Number(lastStatement.slice(8, 10)))) / 86_400_000 > 45;

  if (txnsError) return <EmptyState title="Couldn't load the bank record" description={txnsError} />;

  const visibleRows = compact ? summary.rows.filter((r) => r.hasData || r.provisional) : summary.rows;
  const awaiting = summary.rows.filter((r) => r.provisional && !r.hasData).length;

  return (
    <div className="flex flex-col gap-6">
      <SectionCard
        flush
        className="overflow-hidden"
        title="Financial support"
        description={`Expenses and donations as they cleared the bank. Interest the bank paid is not counted as a donation.${statementStale ? ` The last imported statement line is ${formatDate(lastStatement!)}: upload the later months under Financial → Bank import.` : ""}`}
        actions={
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
        }
      >
        {txnsLoading ? (
          <div className="p-5">
            <LoadingState />
          </div>
        ) : summary.total.monthsWithData === 0 && awaiting === 0 ? (
          <EmptyState
            icon={Landmark}
            title={`No bank statement covers ${shownYear} yet`}
            description="Upload the month's statement under Financial → Bank import and this fills in."
            className="rounded-none border-0 py-8"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-theme-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className={TH}>Month</th>
                  <th className={cn(TH, "text-right")}>Expenses</th>
                  <th className={cn(TH, "text-right")}>Donation</th>
                  <th className={cn(TH, "text-right")}>Net donation</th>
                  <th className={cn(TH, "text-right")}>% of donation spent</th>
                  <th className={TH}>Key monthly drivers</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <SummaryRow key={row.month} row={row} note={notes[row.month]} canConfirm={canConfirm} nameOf={nameOf} onConfirm={(text) => confirm(row.month, text)} onSuggest={() => suggest(row.month)} />
                ))}
                <tr className="bg-muted/40 font-semibold">
                  <td className="px-5 py-3">Total</td>
                  <td className="px-5 py-3 text-right tabular-nums">{money(summary.total.expenses)}</td>
                  <td className="px-5 py-3 text-right tabular-nums">{money(summary.total.donation)}</td>
                  <td className={cn("px-5 py-3 text-right tabular-nums", summary.total.net < 0 && "text-destructive")}>{money(summary.total.net)}</td>
                  <td className="px-5 py-3 text-right tabular-nums">{pct(summary.total.pctSpent)}</td>
                  <td className="px-5 py-3 text-theme-xs font-normal text-muted-foreground">
                    {summary.total.monthsWithData} of 12 months have a statement
                    {awaiting ? `; the ${awaiting} awaiting one ${awaiting === 1 ? "is" : "are"} not in the total` : ""}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {bank ? (
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-t border-border px-5 py-4">
            <span className="text-theme-sm font-medium text-foreground">Cash in bank as of {formatDate(bank.asOf, "MMMM d, yyyy")}</span>
            <span className="text-lg font-bold tabular-nums text-foreground">{peso.format(bank.amount)}</span>
            <span className="w-full text-theme-xs text-muted-foreground">
              The closing balance on the last imported statement line — the bank&apos;s figure, not one worked out from the columns above.
            </span>
          </div>
        ) : null}
      </SectionCard>

      {!compact || donors.length > 0 ? (
        <SectionCard
          flush
          className="overflow-hidden"
          title="Breakdown of monthly donors"
          description={`Cash gifts posted from accounting's Donation Tracker, by the gift's date.${shownDonorMonth ? ` Deposits on the tracker this month: ${peso.format(depositTotal)}.` : ""}`}
          actions={
            receiptMonths.length > 0 ? (
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
            ) : null
          }
        >
          {donors.length === 0 ? (
            <p className="px-5 py-4 text-theme-sm text-muted-foreground">No cash gifts posted for this month yet (names are confirmed on Donors › Cash gifts).</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-theme-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className={TH}>Date</th>
                    <th className={cn(TH, "text-right")}>Amount</th>
                    <th className={TH}>Name</th>
                  </tr>
                </thead>
                <tbody>
                  {donors.map((d) => (
                    <tr key={d.id} className="border-b border-border hover:bg-muted/60">
                      <td className="px-5 py-3 whitespace-nowrap text-muted-foreground">{formatDate(d.date, "MMM d")}</td>
                      <td className="px-5 py-3 text-right tabular-nums">{peso.format(d.amount)}</td>
                      <td className="px-5 py-3">
                        {d.donorName}
                        {d.duplicates > 0 ? (
                          <span className="pl-1.5 text-theme-xs text-muted-foreground" title="Logged on more than one sheet; shown once">
                            ×{d.duplicates + 1} logged
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-muted/40 font-semibold">
                    <td className="px-5 py-3">Total</td>
                    <td className="px-5 py-3 text-right tabular-nums">{peso.format(donorTotal)}</td>
                    <td className="px-5 py-3 text-theme-xs font-normal text-muted-foreground">
                      Receipts are logged by the donor&apos;s date and the bank clears on its own, so this will not equal the month&apos;s Donation figure.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      ) : null}
    </div>
  );
}

const STATUS_LABEL: Record<Exclude<NoteStatus, "none">, { label: string; tone: "positive" | "warning" }> = {
  confirmed: { label: "Confirmed", tone: "positive" },
  needs_confirmation: { label: "Needs confirmation", tone: "warning" },
  new_suggestion: { label: "New suggestion", tone: "warning" },
};

type Result = { ok: true } | { ok: false; error: string };

/**
 * One month's row. The figures are the bank's; the drivers column is the app's draft until a
 * confirmer approves it (0113): confirmers see the draft boxed with Confirm / Edit / Regenerate,
 * everyone else sees the confirmed text, or that one is awaited.
 */
function SummaryRow({ row, note, canConfirm, nameOf, onConfirm, onSuggest }: { row: MonthRow; note: MonthNote | undefined; canConfirm: boolean; nameOf: (id: string) => string | null; onConfirm: (text: string) => Promise<Result>; onSuggest: () => Promise<Result> }) {
  const month = MONTH_NAMES[row.monthNumber - 1];
  const status = noteStatus(note);
  const pending = note?.draft && status !== "confirmed" && status !== "none" ? note.draft : null;
  const [editing, setEditing] = React.useState(false);
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState<"confirm" | "suggest" | null>(null);

  function startEdit(initial: string) {
    setText(initial);
    setEditing(true);
  }
  async function confirmText(value: string) {
    if (!value.trim()) {
      toast.error("Write the summary first.");
      return;
    }
    setBusy("confirm");
    const result = await onConfirm(value);
    setBusy(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setEditing(false);
    toast.success(`${month} confirmed.`);
  }
  async function suggestDraft() {
    setBusy("suggest");
    const result = await onSuggest();
    setBusy(null);
    if (!result.ok) toast.error(result.error);
  }

  // Shown from the tracker, or a statement that stops short: the note stays a draft until the month is complete (0121).
  const shown = row.hasData || row.provisional;
  const draftOnly = row.provisional;
  const confirmedName = note?.confirmedBy ? nameOf(note.confirmedBy) : null;
  const confirmedMeta = note?.confirmedAt && note.drivers ? `Confirmed${confirmedName ? ` by ${confirmedName}` : ""} · ${formatDate(note.confirmedAt.slice(0, 10), "MMM d")}` : null;

  return (
    <tr className={cn("border-b border-border align-top hover:bg-muted/60", !shown && "text-muted-foreground")}>
      <td className="px-5 py-3 whitespace-nowrap font-medium">
        {month}
        {row.provisional ? (
          <Badge
            className={cn("mt-1 block w-fit font-normal", STATUS_TONE_CLASSES.warning)}
            title={row.hasData ? "The bank statement stops short of the month's end." : "Donation is the Donation Tracker's BDO deposits; expenses come with the bank statement."}
          >
            {row.hasData ? "Statement incomplete" : "Statement pending"}
          </Badge>
        ) : null}
      </td>
      <td className="px-5 py-3 text-right tabular-nums">{money(row.expenses)}</td>
      <td className="px-5 py-3 text-right tabular-nums">{money(row.hasData ? row.donation : row.trackerDonation)}</td>
      <td className={cn("px-5 py-3 text-right tabular-nums", row.net !== null && row.net < 0 && "text-destructive")}>{money(row.net)}</td>
      <td className={cn("px-5 py-3 text-right tabular-nums", row.pctSpent !== null && row.pctSpent > 1 && "text-destructive")}>{pct(row.pctSpent)}</td>
      <td className="px-5 py-3 text-theme-xs">
        <div className="flex flex-col gap-1.5">
          {shown && status !== "none" ? (
            <Badge className={cn("w-fit", STATUS_TONE_CLASSES[STATUS_LABEL[status].tone])}>{STATUS_LABEL[status].label}</Badge>
          ) : null}
          {editing ? (
            <>
              <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} autoFocus disabled={busy !== null} placeholder="What drove this month's numbers — the big gifts, the one-off costs, what was advanced and settled later." />
              <div className="flex gap-1.5">
                <Button size="sm" onClick={() => confirmText(text)} disabled={busy !== null}>
                  {busy === "confirm" ? "Confirming…" : "Save and confirm"}
                </Button>
                <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <>
              {note?.drivers ? (
                <div className="group flex items-start gap-1.5">
                  <span className="max-w-prose">{note.drivers}</span>
                  {canConfirm && !draftOnly ? (
                    <Button variant="ghost" size="icon-sm" className="shrink-0 opacity-60 group-hover:opacity-100" aria-label={`Edit ${month} summary`} onClick={() => startEdit(note.drivers)}>
                      <Pencil className="size-3.5" />
                    </Button>
                  ) : null}
                </div>
              ) : shown && draftOnly && pending ? (
                <span className="max-w-prose">{pending}</span>
              ) : shown && !(canConfirm && pending) ? (
                <span className="italic text-muted-foreground">{pending ? "Awaiting confirmation." : "No summary yet."}</span>
              ) : null}
              {confirmedMeta ? <span className="text-muted-foreground">{confirmedMeta}</span> : null}
              {draftOnly && shown ? (
                <div className="flex flex-col gap-1.5">
                  <span className="text-muted-foreground">Draft: confirmed once the month has ended and its bank statement is in. Refreshed every night at 1:00 AM.</span>
                  {canConfirm ? (
                    <Button size="sm" variant="outline" className="h-7 w-fit gap-1.5" disabled={busy !== null} onClick={suggestDraft}>
                      <Sparkles className="size-3.5" />
                      {busy === "suggest" ? "Drafting…" : pending ? "Regenerate" : "Suggest"}
                    </Button>
                  ) : null}
                </div>
              ) : canConfirm && pending ? (
                <div className="rounded-lg border border-warning/40 bg-warning/5 p-2.5">
                  <p className="mb-1 font-medium">{status === "new_suggestion" ? "New suggestion from this month's records" : "Suggested from this month's records"}</p>
                  <p className="max-w-prose">{pending}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Button size="sm" disabled={busy !== null} onClick={() => confirmText(pending)}>
                      {busy === "confirm" ? "Confirming…" : "Confirm"}
                    </Button>
                    <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => startEdit(pending)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy !== null} onClick={suggestDraft}>
                      {busy === "suggest" ? "Drafting…" : "Regenerate"}
                    </Button>
                  </div>
                </div>
              ) : canConfirm && shown ? (
                <div>
                  <Button size="sm" variant="outline" className="h-7 gap-1.5" disabled={busy !== null} onClick={suggestDraft}>
                    <Sparkles className="size-3.5" />
                    {busy === "suggest" ? "Drafting…" : note?.drivers ? "Regenerate" : "Suggest"}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </td>
    </tr>
  );
}
