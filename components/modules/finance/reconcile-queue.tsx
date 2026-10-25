"use client";

import * as React from "react";
import { toast } from "sonner";
import { Link2, Ban } from "lucide-react";
import { SectionCard } from "@/components/patterns/section-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { useBankTransactionsData, type BankTransaction } from "@/lib/hooks/use-bank-transactions-collection";
import { useCashDepositsData } from "@/lib/hooks/use-cash-deposits-collection";
import { useDonorsData } from "@/lib/hooks/use-donors-collection";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate } from "@/lib/utils/date";

const SINCE = "2026-01-01";
const WINDOW_DAYS = 7;
const dayNumber = (iso: string) => Math.round(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000);

/**
 * Finance > Approvals > To reconcile (0111): bank credits since January the automatic pass could
 * not place -- each with the cash gifts and deposits of the same amount within a week, to link
 * with one click, or to mark "not a donation" (a transfer, a sale). The automatic pass runs after
 * every tracker read; this list is what it left.
 */
export function ReconcileQueue() {
  const { transactions, loading } = useBankTransactionsData();
  const { deposits } = useCashDepositsData();
  const { donors, donations } = useDonorsData();
  const [busy, setBusy] = React.useState<string | null>(null);

  const nameOf = React.useMemo(() => new Map(donors.map((d) => [d.id, d.name])), [donors]);
  const linkedGifts = React.useMemo(() => new Set(transactions.map((t) => t.donationId).filter(Boolean)), [transactions]);
  const linkedDeposits = React.useMemo(() => new Set(transactions.map((t) => t.depositId).filter(Boolean)), [transactions]);
  const credits = React.useMemo(
    () => transactions.filter((t) => t.credit > 0 && t.postingDate >= SINCE && !t.donationId && !t.depositId && t.category === null).sort((a, b) => b.postingDate.localeCompare(a.postingDate)),
    [transactions]
  );
  const gifts = React.useMemo(() => donations.filter((d) => d.kind === "cash" && d.date >= SINCE && !linkedGifts.has(d.id)), [donations, linkedGifts]);

  const candidates = (t: BankTransaction) => {
    const day = dayNumber(t.postingDate);
    return {
      gifts: gifts.filter((g) => g.totalValue === t.credit && Math.abs(dayNumber(g.date) - day) <= WINDOW_DAYS),
      deposits: deposits.filter((d) => d.amount === t.credit && !linkedDeposits.has(d.id) && Math.abs(dayNumber(d.date) - day) <= WINDOW_DAYS),
    };
  };

  async function decide(t: BankTransaction, args: { donationId?: string; depositId?: string; notDonation?: boolean }) {
    setBusy(t.id);
    const { error } = await createClient().schema("ops").rpc("reconcile_bank_credit", { p_bank_id: t.id, p_donation_id: args.donationId ?? null, p_deposit_id: args.depositId ?? null, p_not_donation: args.notDonation ?? false });
    setBusy(null);
    if (error) return void toast.error(error.message);
    toast.success(args.notDonation ? "Marked: not a donation." : "Linked.");
  }

  return (
    <SectionCard
      title={`To reconcile${credits.length ? ` (${credits.length})` : ""}`}
      description="Bank credits since January not yet matched to a cash gift or a deposit. The automatic pass links the unambiguous ones after every Donation Tracker read; decide the rest here."
      flush
    >
      {loading ? (
        <p className="px-5 py-4 text-theme-sm text-muted-foreground">Loading…</p>
      ) : credits.length === 0 ? (
        <p className="px-5 py-4 text-theme-sm text-muted-foreground">Every bank credit since January is matched or marked.</p>
      ) : (
        <ul className="divide-y divide-border">
          {credits.map((t) => {
            const c = candidates(t);
            return (
              <li key={t.id} className="flex flex-col gap-2 px-5 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-theme-sm text-foreground">
                    <span className="text-muted-foreground">{formatDate(t.postingDate)}</span> · {t.description}
                  </span>
                  <span className="text-theme-sm font-semibold tabular-nums">{formatCurrency(t.credit, "PHP")}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {c.gifts.map((g) => (
                    <Button key={g.id} size="sm" variant="outline" disabled={busy === t.id} onClick={() => void decide(t, { donationId: g.id })}>
                      <Link2 className="size-3.5" /> Gift · {nameOf.get(g.donorId) ?? "Child on file"} · {formatDate(g.date, "MMM d")}
                    </Button>
                  ))}
                  {c.deposits.map((d) => (
                    <Button key={d.id} size="sm" variant="outline" disabled={busy === t.id} onClick={() => void decide(t, { depositId: d.id })}>
                      <Link2 className="size-3.5" /> Deposit · {formatDate(d.date, "MMM d")}
                      {d.invoiceNumber ? ` · ${d.invoiceNumber}` : ""}
                    </Button>
                  ))}
                  {c.gifts.length === 0 && c.deposits.length === 0 ? <Badge variant="outline">No gift or deposit of this amount within a week</Badge> : null}
                  <Button size="sm" variant="ghost" disabled={busy === t.id} onClick={() => void decide(t, { notDonation: true })}>
                    <Ban className="size-3.5" /> Not a donation
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
