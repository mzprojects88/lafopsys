"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSetupRows } from "@/lib/hooks/use-finance-setup";
import { payVoucher, type Voucher } from "@/lib/hooks/use-vouchers";
import { formatCurrency } from "@/lib/utils/currency";
import { PAY_LABEL } from "@/lib/utils/vouchers";

export type PayStep = "prepare_payment" | "approve_payment" | "release";
const TITLE: Record<PayStep, string> = { prepare_payment: "Prepare the payment", approve_payment: "Approve the payment", release: "Release the payment" };

/**
 * The payment steps (0139): Finance prepares the payment (the cash or bank account it is paid from, the check or
 * transfer reference), the signatory approves it, the releaser releases it. A liquidation is settled at release:
 * the account the change comes back to, or the overspend is paid from. The database checks who signs each step.
 */
export function PayDialog({ voucher, step, settles, open, onOpenChange }: { voucher: Voucher; step: PayStep; /** A liquidation's change (+) or overspend (−). */ settles?: number; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data: accounts } = useSetupRows("coa_accounts");
  const cash = accounts.filter((a) => String(a.code ?? "").startsWith("11") && !a.is_header && a.active !== false && !a.review_note);
  // The account last used for this payment method, on this device (a convenience; the database checks the account).
  const remembered = `laf.payFrom.${voucher.payMethod}`;
  const [account, setAccount] = React.useState(() => {
    try {
      return localStorage.getItem(remembered) ?? "";
    } catch {
      return "";
    }
  });
  const accountShown = cash.some((a) => a.id === account) ? account : "";
  const [reference, setReference] = React.useState("");
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const net = voucher.total - voucher.ewtTotal;
  const asksAccount = step === "prepare_payment" || (step === "release" && !!settles);
  const asksReference = step === "prepare_payment" && voucher.payMethod !== "cash";
  const from = accounts.find((a) => a.id === voucher.paidFromAccountId);

  async function go() {
    setBusy(true);
    const r = await payVoucher(voucher.id, step, asksAccount ? accountShown : null, reference, note);
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    if (asksAccount && step === "prepare_payment") {
      try {
        localStorage.setItem(remembered, accountShown);
      } catch {
        // Private windows may refuse storage; the next payment just starts empty.
      }
    }
    toast.success(r.value === "released" ? "Released: posted to the cash book" : "Done");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{voucher.kind === "liquidation" ? "Settle the liquidation" : TITLE[step]} · {voucher.voucherNumber}</DialogTitle>
          <DialogDescription>
            {voucher.kind === "liquidation"
              ? settles
                ? `${formatCurrency(Math.abs(settles), "PHP", true)} ${settles > 0 ? "comes back from the requester" : "is paid to the requester"}.`
                : "Spent exactly what was advanced: nothing to pay or return."
              : `${PAY_LABEL[voucher.payMethod]} · ${formatCurrency(net, "PHP", true)} to pay${voucher.ewtTotal > 0 ? ` (after ${formatCurrency(voucher.ewtTotal, "PHP", true)} withheld)` : ""}${from ? ` · from ${String(from.code)} ${String(from.name)}` : ""}${voucher.payReference ? ` · ${voucher.payReference}` : ""}.`}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {asksAccount ? (
            <Field>
              <FieldLabel>{step === "release" ? (settles! > 0 ? "Account the change goes into" : "Account the overspend is paid from") : "Paid from"}</FieldLabel>
              <Select value={accountShown} onValueChange={setAccount}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Pick the cash or bank account" /></SelectTrigger>
                <SelectContent>
                  {cash.map((a) => <SelectItem key={String(a.id)} value={String(a.id)}>{String(a.code)} {String(a.name)}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          ) : null}
          {asksReference ? (
            <Field>
              <FieldLabel htmlFor="pay-ref">{voucher.payMethod === "check" ? "Check number" : "Transfer reference"}</FieldLabel>
              <Input id="pay-ref" maxLength={60} value={reference} onChange={(e) => setReference(e.target.value)} />
            </Field>
          ) : null}
          {step === "release" ? <FieldDescription>Attach the proof (the signed voucher, the deposit slip or the transfer receipt) under Receipts and papers.</FieldDescription> : null}
          <Field>
            <FieldLabel htmlFor="pay-note">Note (optional)</FieldLabel>
            <Textarea id="pay-note" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={busy || (asksAccount && !accountShown) || (asksReference && !reference.trim())} onClick={() => void go()}>
            {busy ? "Saving…" : voucher.kind === "liquidation" && step === "release" ? "Settle" : TITLE[step].replace(" the payment", "")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
