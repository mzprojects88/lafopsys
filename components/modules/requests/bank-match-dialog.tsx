"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import { matchToBank, type Voucher } from "@/lib/hooks/use-vouchers";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate } from "@/lib/utils/date";
import { dayKey } from "@/lib/utils/dtr";

interface Debit { id: string; posting_date: string; description: string; debit: number; check_number: string | null }
const shift = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * Match a paid voucher to its bank debit (0139): the imported statement lines of the same net amount, not yet
 * matched, from a week before the release to a month after (checks clear late). The database re-checks all of it.
 */
export function BankMatchDialog({ voucher, open, onOpenChange }: { voucher: Voucher; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [debits, setDebits] = React.useState<Debit[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const net = Math.round((voucher.total - voucher.ewtTotal) * 100) / 100;

  React.useEffect(() => {
    if (!open || !voucher.releasedAt) return;
    const day = dayKey(voucher.releasedAt);
    void createClient().schema("ops").from("bank_transactions").select("id, posting_date, description, debit, check_number")
      .eq("debit", net).is("matched_cash_entry_id", null).gte("posting_date", shift(day, -7)).lte("posting_date", shift(day, 31)).order("posting_date")
      .then(({ data }) => setDebits((data ?? []) as Debit[]));
  }, [open, voucher.releasedAt, net]);

  async function pick(id: string | null) {
    setBusy(true);
    const r = await matchToBank(voucher.id, id);
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success(id ? "Matched to the bank" : "Unmatched");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Match to the bank · {voucher.voucherNumber}</DialogTitle>
          <DialogDescription>Debits of {formatCurrency(net, "PHP", true)} on the imported statements, not matched yet{voucher.payReference ? `; this voucher's reference is ${voucher.payReference}` : ""}.</DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
          {(debits ?? []).map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 px-3 py-2 text-theme-sm">
              <span>
                {formatDate(d.posting_date)} · {d.description}
                {d.check_number ? <span className="block text-theme-xs text-muted-foreground">Check {d.check_number}</span> : null}
              </span>
              <Button size="sm" disabled={busy} onClick={() => void pick(d.id)}>Match</Button>
            </li>
          ))}
          {debits && debits.length === 0 ? <li className="px-3 py-4 text-center text-theme-sm text-muted-foreground">No debit of this amount yet. Import the statement (Financial › Bank Import) and come back.</li> : null}
          {debits === null ? <li className="px-3 py-4 text-center text-theme-sm text-muted-foreground">Looking…</li> : null}
        </ul>
        {voucher.bankTransactionId ? <Button variant="ghost" className="self-start text-destructive" disabled={busy} onClick={() => void pick(null)}>Unmatch the current debit</Button> : null}
      </DialogContent>
    </Dialog>
  );
}
