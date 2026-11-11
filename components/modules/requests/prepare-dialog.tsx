"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldLabel } from "@/components/ui/field";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSetupRows } from "@/lib/hooks/use-finance-setup";
import { useStaffRoster } from "@/lib/hooks/use-staff-roster";
import { fixHistory, prepareVoucher, similarCount, type Voucher, type VoucherLine } from "@/lib/hooks/use-vouchers";
import { formatCurrency } from "@/lib/utils/currency";
import { fundAllows } from "@/lib/utils/vouchers";

const NONE = "__none";

/**
 * Finance prepares the voucher (Marivic's steps 3-4): checks the request, confirms the fund, the employee code
 * and each item's account and cost center / program, and gives it its number. The database refuses an unusable
 * account, a restricted fund paying what it may not, or someone who doesn't prepare vouchers for this amount.
 */
export function PrepareDialog({ voucher, lines, open, onOpenChange, history = false }: { voucher: Voucher; lines: VoucherLine[]; open: boolean; onOpenChange: (o: boolean) => void; /** A voucher from the registers (0136): correct its coding, nothing else. */ history?: boolean }) {
  const { data: accounts } = useSetupRows("coa_accounts");
  const { data: codes } = useSetupRows("fin_codes");
  const { staff } = useStaffRoster();
  const [fund, setFund] = React.useState(voucher.t2Id ?? "");
  const [t4, setT4] = React.useState(voucher.t4StaffId ?? NONE);
  const [coding, setCoding] = React.useState(() => lines.map((l) => ({ id: l.id, account_id: l.accountId, t1_id: l.t1Id, t3_id: l.t3Id })));
  const [note, setNote] = React.useState("");
  const [similar, setSimilar] = React.useState(0);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (open && !history) void similarCount(voucher.id).then(setSimilar);
  }, [open, voucher.id, history]);

  const usable = accounts.filter((a) => !a.is_header && a.active !== false && a.code && !a.review_note);
  const t1 = codes.filter((c) => c.tier === "T1" && c.active);
  const t3 = codes.filter((c) => c.tier === "T3" && c.active);
  const funds = codes.filter((c) => c.tier === "T2" && c.active);
  const chosenFund = funds.find((f) => f.id === fund);
  const set = (n: number, patch: Partial<(typeof coding)[number]>) => setCoding((c) => c.map((x, i) => (i === n ? { ...x, ...patch } : x)));
  const codeOf = (id: string | null) => String(accounts.find((a) => a.id === id)?.code ?? "");

  async function prepare() {
    setBusy(true);
    if (history) {
      const r = await fixHistory(voucher.id, fund || null, coding, note);
      setBusy(false);
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.value ? "Corrected: cleaned up" : "Corrected; something is still to clean up");
      return void onOpenChange(false);
    }
    const r = await prepareVoucher(voucher.id, fund, t4 === NONE ? null : t4, coding, note);
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success(`Prepared as ${r.value}`);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{history ? `Correct the coding · ${voucher.voucherNumber}` : `Prepare the voucher · ${voucher.requestNumber}`}</DialogTitle>
          <DialogDescription>
            Check the request and its papers, confirm the coding, then prepare: it gets its {voucher.kind === "petty_cash" ? "PCV" : voucher.payMethod === "gcash" ? "GCV" : "PV"} number and goes to the reviewer.
            The budget for the month is on <Link href="/finance/budget" className="text-primary hover:underline">Budget vs Actual</Link>.
          </DialogDescription>
        </DialogHeader>
        {similar > 0 ? (
          <p className="flex items-center gap-2 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-theme-sm">
            <AlertTriangle className="size-4 text-warning" /> {similar} other {similar === 1 ? "request looks" : "requests look"} like this one (same OR number, or same payee and amount within 30 days). Check it isn&apos;t paid twice.
          </p>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel>Fund that pays (T2)</FieldLabel>
            <Select value={fund} onValueChange={setFund}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Pick the fund" /></SelectTrigger>
              <SelectContent>
                {funds.map((f) => (
                  <SelectItem key={String(f.id)} value={String(f.id)}>{String(f.code)} · {String(f.name)}{f.restricted ? " (restricted)" : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel>Employee (T4), for staff costs and advances</FieldLabel>
            <Select value={t4} onValueChange={setT4}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>None</SelectItem>
                {staff.filter((s) => s.active).map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.firstName} {s.lastName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <div className="flex flex-col gap-3">
          {lines.map((l, n) => {
            const c = coding[n];
            const blocked = chosenFund?.restricted && !fundAllows((chosenFund.account_prefixes as string[]) ?? [], codeOf(c.account_id));
            return (
              <div key={l.id} className="grid gap-2 rounded-xl border border-border p-3 sm:grid-cols-12">
                <div className="sm:col-span-12 flex flex-wrap justify-between gap-2 text-theme-sm">
                  <span className="font-medium">{n + 1}. {l.description}{l.orNumber ? ` · OR ${l.orNumber}` : " · no OR number"}</span>
                  <span className="tabular-nums">{formatCurrency(l.amount, "PHP", true)}</span>
                </div>
                <Select value={c.account_id ?? ""} onValueChange={(v) => set(n, { account_id: v })}>
                  <SelectTrigger className="w-full sm:col-span-6" aria-label={`Item ${n + 1}: account`}><SelectValue placeholder="Account" /></SelectTrigger>
                  <SelectContent>
                    {usable.map((a) => (
                      <SelectItem key={String(a.id)} value={String(a.id)}>{String(a.code)} {String(a.name)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={c.t1_id ?? ""} onValueChange={(v) => set(n, { t1_id: v })}>
                  <SelectTrigger className="w-full sm:col-span-3" aria-label={`Item ${n + 1}: cost center`}><SelectValue placeholder="Cost center" /></SelectTrigger>
                  <SelectContent>
                    {t1.map((x) => (
                      <SelectItem key={String(x.id)} value={String(x.id)}>{String(x.code)} · {String(x.name)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={c.t3_id ?? NONE} onValueChange={(v) => set(n, { t3_id: v === NONE ? null : v })}>
                  <SelectTrigger className="w-full sm:col-span-3" aria-label={`Item ${n + 1}: program`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>No program</SelectItem>
                    {t3.map((x) => (
                      <SelectItem key={String(x.id)} value={String(x.id)}>{String(x.code)} · {String(x.name)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {blocked ? <p className="sm:col-span-12 text-theme-xs text-warning-foreground">{String(chosenFund?.name)} is restricted and may not pay for {codeOf(c.account_id)}: change the fund or the account.</p> : null}
              </div>
            );
          })}
        </div>
        <Field>
          <FieldLabel htmlFor="prep-note">Note (optional)</FieldLabel>
          <Textarea id="prep-note" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={busy || (!fund && !history)} onClick={() => void prepare()}>{busy ? "Saving…" : history ? "Save corrections" : "Prepare voucher"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
