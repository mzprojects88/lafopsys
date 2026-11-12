"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { saveSetupRow, useSetupRows, type SetupRow } from "@/lib/hooks/use-finance-setup";
import { fundStatusStore } from "@/lib/hooks/use-vouchers";
import { useStaffRoster } from "@/lib/hooks/use-staff-roster";

const NONE = "__none";

/**
 * A fund set up from its card (polish 5): its float, the point to top it up at, who keeps it and its account. The
 * same row as Financial Settings › Funds, saved and logged the same way, offering the same accounts. Opened with the
 * fund's saved row (the page waits for it), so nothing it doesn't show is overwritten.
 */
export function FundSetupDialog({ fund, open, onOpenChange }: { fund: SetupRow; open: boolean; onOpenChange: (o: boolean) => void }) {
  const fundId = String(fund.id);
  const { data: accounts } = useSetupRows("coa_accounts");
  const { staff } = useStaffRoster();
  const [float, setFloat] = React.useState(fund.float_amount == null ? "" : String(fund.float_amount));
  const [topUp, setTopUp] = React.useState(fund.top_up_below == null ? "" : String(fund.top_up_below));
  const [keeper, setKeeper] = React.useState(String(fund.custodian_staff_id ?? NONE));
  const [account, setAccount] = React.useState(String(fund.account_id ?? NONE));
  const [busy, setBusy] = React.useState(false);
  // Settings › Funds offers any postable account; so does this.
  const cash = accounts.filter((a) => !a.is_header && a.code);
  const f = Number(float);
  const t = topUp === "" ? null : Number(topUp);
  const problem = !(f > 0) ? "Give the float (above zero)." : t != null && !(t >= 0 && t < f) ? "The top-up point must be below the float." : null;

  async function save() {
    setBusy(true);
    const r = await saveSetupRow("cash_funds", fundId, {
      float_amount: f,
      top_up_below: t,
      custodian_staff_id: keeper === NONE ? null : keeper,
      account_id: account === NONE ? null : account,
    });
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    await fundStatusStore.refetch();
    toast.success("Fund saved");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Set up {String(fund.name)}</DialogTitle>
          <DialogDescription>Cash on hand is the float less the slips paid from it; below the top-up point, it is topped up from the open slips.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="fund-float">Float (₱)</FieldLabel>
            <Input id="fund-float" type="number" inputMode="decimal" min={0} value={float} onChange={(e) => setFloat(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="fund-topup">Top up below (₱)</FieldLabel>
            <Input id="fund-topup" type="number" inputMode="decimal" min={0} value={topUp} onChange={(e) => setTopUp(e.target.value)} placeholder="Optional" />
          </Field>
          <Field className="sm:col-span-2">
            <FieldLabel>Kept by</FieldLabel>
            <Select value={keeper} onValueChange={setKeeper}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Nobody yet</SelectItem>
                {staff.filter((s) => s.active).map((s) => <SelectItem key={s.id} value={s.id}>{s.firstName} {s.lastName}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field className="sm:col-span-2">
            <FieldLabel>Its account</FieldLabel>
            <Select value={account} onValueChange={setAccount}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Not set</SelectItem>
                {cash.map((a) => <SelectItem key={String(a.id)} value={String(a.id)}>{String(a.code)} {String(a.name)}</SelectItem>)}
              </SelectContent>
            </Select>
            <FieldDescription>A slip is paid from this account; its top-up refills it.</FieldDescription>
          </Field>
        </div>
        <DialogFooter className="flex-wrap items-center">
          {problem ? <p className="mr-auto text-theme-xs text-warning-foreground">{problem}</p> : null}
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={busy || !!problem} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
