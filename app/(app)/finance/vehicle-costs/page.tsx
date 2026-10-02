"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { CheckCircle2, Fuel, HandCoins, Paperclip, Send, Wrench } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { SectionCard } from "@/components/patterns/section-card";
import { EmptyState } from "@/components/patterns/empty-state";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { FileLibrary } from "@/components/patterns/file-library";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useCollection } from "@/lib/data/collection-store";
import { useModuleAccess } from "@/lib/hooks/use-module-access";
import { useStaffRoster } from "@/lib/hooks/use-staff-roster";
import { useVehicles } from "@/lib/hooks/use-vehicles-collection";
import { expenseKindsStore, financeVehicleCostsStore, postVehicleExpense, type VehicleExpense } from "@/lib/hooks/use-vehicle-expenses-collection";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate, todayIso } from "@/lib/utils/date";
import { formatPesoCents } from "@/lib/utils/vehicle-expenses";

/**
 * Finance › Vehicle costs (Fuel Monitoring E, 0080): every fuel and expense entry from Transport,
 * posted to Finance with one tap. A driver-paid entry is posted when the driver is paid back,
 * dated that day, so the cost is counted once.
 */
export default function VehicleCostsPage() {
  const access = useModuleAccess();
  const canPost = access.canEdit("finance");
  const { data: entries, loading } = useCollection(financeVehicleCostsStore);
  const { data: kinds } = useCollection(expenseKindsStore);
  const { vehicles } = useVehicles();
  const { staff } = useStaffRoster();
  const [posting, setPosting] = React.useState<string | null>(null);
  const [reimbursing, setReimbursing] = React.useState<VehicleExpense | null>(null);
  const [receiptsFor, setReceiptsFor] = React.useState<VehicleExpense | null>(null);

  const kindName = (id: string) => kinds.find((k) => k.id === id)?.name ?? id;
  const vehicleName = (id: string) => vehicles.find((v) => v.id === id)?.name ?? "Vehicle";
  const person = (id: string | null) => {
    const s = staff.find((x) => x.id === id);
    return s ? `${s.firstName} ${s.lastName}` : "the driver";
  };
  const toPost = entries.filter((e) => !e.posting);
  const owed = toPost.filter((e) => e.paidBy === "driver");
  const posted = entries.filter((e) => e.posting).slice(0, 30);

  async function post(e: VehicleExpense) {
    setPosting(e.id);
    const r = await postVehicleExpense(e.id);
    setPosting(null);
    if (r.ok) toast.success("Posted to Finance as a pending entry");
    else toast.error(r.error);
  }

  if (!access.loading && !access.canView("finance")) {
    return <EmptyState icon={Fuel} title="Vehicle costs are for Finance" description="Ask the Super Admin for Finance access." />;
  }

  const row = (e: VehicleExpense, actions: React.ReactNode) => (
    <li key={e.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-theme-sm font-medium">
          {e.kind === "fuel" ? <Fuel className="size-4 text-muted-foreground" /> : <Wrench className="size-4 text-muted-foreground" />}
          {kindName(e.kind)} · {formatPesoCents(e.amount)}
        </span>
        <span className="flex flex-wrap items-center gap-1">{actions}</span>
      </div>
      <span className="text-theme-xs text-muted-foreground tabular-nums">
        {formatDate(e.date, "EEE, MMM d, yyyy")} · {vehicleName(e.vehicleId)}
        {e.litres != null ? ` · ${e.litres} L` : ""}
        {e.vendor ? ` · ${e.vendor}` : ""}
        {e.paidBy === "driver" ? ` · paid by ${person(e.paidByStaffId)}` : " · paid by LAF"}
      </span>
    </li>
  );

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Vehicle costs"
        description="Fuel and vehicle expenses from Transport. Post each to Finance; a driver who paid is posted when paid back."
        action={
          <Button variant="outline" asChild>
            <Link href="/finance/approvals">Approvals</Link>
          </Button>
        }
      />

      <KpiGrid>
        <KpiCard label="To post" value={loading ? "…" : toPost.length} icon={Send} sublabel={formatCurrency(toPost.reduce((s, e) => s + e.amount, 0))} />
        <KpiCard
          label="Owed to drivers"
          value={loading ? "…" : formatCurrency(owed.reduce((s, e) => s + e.amount, 0))}
          icon={HandCoins}
          tone={owed.length ? "warning" : "default"}
          sublabel={`${owed.length} ${owed.length === 1 ? "entry" : "entries"}`}
        />
      </KpiGrid>

      <SectionCard title="To post" description="Oldest first is fine: each is posted on its own date.">
        {toPost.length === 0 ? (
          <p className="text-theme-sm text-muted-foreground">{loading ? "Loading…" : "Everything from Transport is posted."}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {toPost.map((e) =>
              row(
                e,
                <>
                  <Button variant="ghost" size="sm" onClick={() => setReceiptsFor(e)}>
                    <Paperclip /> Receipts
                  </Button>
                  {canPost &&
                    (e.paidBy === "driver" ? (
                      <Button size="sm" onClick={() => setReimbursing(e)}>
                        <HandCoins /> Paid back · post
                      </Button>
                    ) : (
                      <Button size="sm" disabled={posting === e.id} onClick={() => post(e)}>
                        <Send /> Post
                      </Button>
                    ))}
                </>
              )
            )}
          </ul>
        )}
      </SectionCard>

      {posted.length > 0 && (
        <SectionCard title="Posted" description="The latest 30. Correct a posted cost on its cash entry in Finance.">
          <ul className="flex flex-col divide-y divide-border">
            {posted.map((e) =>
              row(
                e,
                <>
                  {e.posting?.reimbursedOn && (
                    <Badge variant="outline">
                      Paid back {formatPesoCents(e.posting.reimbursedAmount ?? e.amount)} · {formatDate(e.posting.reimbursedOn, "MMM d")}
                    </Badge>
                  )}
                  <Badge variant="secondary">
                    <CheckCircle2 /> Posted {formatDate(e.posting!.postedAt, "MMM d")}
                  </Badge>
                </>
              )
            )}
          </ul>
        </SectionCard>
      )}

      {reimbursing && <ReimburseDialog expense={reimbursing} payee={person(reimbursing.paidByStaffId)} onClose={() => setReimbursing(null)} />}
      {receiptsFor && (
        <Dialog open onOpenChange={(o) => !o && setReceiptsFor(null)}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Receipts</DialogTitle>
              <DialogDescription>
                {kindName(receiptsFor.kind)} · {formatPesoCents(receiptsFor.amount)} · {formatDate(receiptsFor.date, "MMM d, yyyy")}
              </DialogDescription>
            </DialogHeader>
            <FileLibrary recordType="vehicle_expense" recordId={receiptsFor.id} canUpload={false} canDelete={false} compact />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

/** A driver paid: record the pay-back, which is what posts the cost (dated that day). */
function ReimburseDialog({ expense, payee, onClose }: { expense: VehicleExpense; payee: string; onClose: () => void }) {
  const [on, setOn] = React.useState(todayIso());
  const [amount, setAmount] = React.useState(expense.amount.toString());
  const [saving, setSaving] = React.useState(false);
  const bad = !(Number(amount) > 0) || on > todayIso() || on < expense.date;

  async function save() {
    setSaving(true);
    const r = await postVehicleExpense(expense.id, { on, amount: Number(amount) });
    setSaving(false);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    toast.success(`${payee} paid back; posted to Finance`);
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pay back {payee}</DialogTitle>
          <DialogDescription>
            {formatPesoCents(expense.amount)} paid on {formatDate(expense.date, "MMM d, yyyy")}. Posting records the pay-back and the cost, dated the day paid back.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel htmlFor="rbOn">Paid back on</FieldLabel>
            <Input id="rbOn" type="date" min={expense.date} max={todayIso()} value={on} onChange={(e) => setOn(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="rbAmount">Amount (₱)</FieldLabel>
            <Input id="rbAmount" type="number" inputMode="decimal" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={bad || saving} onClick={save}>
            {saving ? "Posting…" : "Paid back · post"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
