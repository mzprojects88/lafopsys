"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { quickBooksJournal, type Voucher } from "@/lib/hooks/use-vouchers";
import { csvLines, downloadCsv } from "@/lib/utils/csv";
import { formatDate } from "@/lib/utils/date";
import { dayKey } from "@/lib/utils/dtr";
import { KIND_LABEL, PAY_LABEL } from "@/lib/utils/vouchers";

/**
 * Export for QuickBooks (0139), for whoever holds the export power: the vouchers paid in the page's period as a
 * QuickBooks journal (one balanced entry each) and a register; marking them exported warns on the next export.
 * The exact columns are confirmed with one test import by the accountant.
 */
export function QuickBooksExport({ from, to, vouchers, open, onOpenChange }: { from: string; to: string; vouchers: Voucher[]; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [mark, setMark] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const paid = vouchers.filter((v) => v.status === "released" && v.source === "app" && v.releasedAt && dayKey(v.releasedAt) >= from && dayKey(v.releasedAt) <= to);
  const before = paid.filter((v) => v.exportedAt).length;
  async function go() {
    setBusy(true);
    const r = await quickBooksJournal(from, to, mark);
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    const amount = (n: number | null) => (n == null ? "" : n.toFixed(2));
    downloadCsv(csvLines(["Journal No", "Journal Date", "Account", "Debits", "Credits", "Description", "Name", "Class"], r.value.map((x) => [x.journal_no, x.journal_date, x.account, amount(x.debit), amount(x.credit), x.description, x.name, x.class ?? ""])), `quickbooks-journal-${from}-to-${to}.csv`);
    downloadCsv(csvLines(["Voucher", "Paid on", "Kind", "Pay to", "Total", "Withheld", "Net", "Method", "Reference", "Exported before"], paid.map((v) => [v.voucherNumber ?? "", dayKey(v.releasedAt!), KIND_LABEL[v.kind], r.value.find((x) => x.voucher_id === v.id)?.name ?? "", v.total.toFixed(2), v.ewtTotal.toFixed(2), (v.total - v.ewtTotal).toFixed(2), PAY_LABEL[v.payMethod], v.payReference ?? "", v.exportedAt ? "yes" : "no"])), `voucher-register-${from}-to-${to}.csv`);
    toast.success(`${paid.length} voucher${paid.length === 1 ? "" : "s"} exported`);
    onOpenChange(false);
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export for QuickBooks</DialogTitle>
          <DialogDescription>Vouchers paid from {formatDate(from)} to {formatDate(to)} (the period above): a journal to import and a register.</DialogDescription>
        </DialogHeader>
        <p className="text-theme-sm">{paid.length} paid voucher{paid.length === 1 ? "" : "s"}{before ? `; ${before} exported before: importing them again would count them twice in QuickBooks.` : "."}</p>
        <label className="flex items-center gap-2 text-theme-sm"><input type="checkbox" checked={mark} onChange={(e) => setMark(e.target.checked)} /> Mark them exported</label>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={busy || paid.length === 0} onClick={() => void go()}>{busy ? "Exporting…" : "Download"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
