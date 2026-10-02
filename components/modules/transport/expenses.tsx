"use client";

import * as React from "react";
import { toast } from "sonner";
import { Ban, Fuel, Paperclip, Pencil, Wrench } from "lucide-react";
import { FileLibrary } from "@/components/patterns/file-library";
import { ReasonDialog } from "@/components/patterns/reason-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useRole } from "@/context/role-provider";
import { uploadFileToRecord } from "@/lib/files/upload-client";
import { useStaffRoster } from "@/lib/hooks/use-staff-roster";
import { useVehicleExpenses, type ExpenseInput, type VehicleExpense } from "@/lib/hooks/use-vehicle-expenses-collection";
import type { Vehicle } from "@/lib/hooks/use-vehicles-collection";
import { canDeleteFiles, canUploadFiles } from "@/lib/rbac/roles";
import { formatDate, todayIso } from "@/lib/utils/date";
import { formatKm, readingProblem } from "@/lib/utils/odometer";
import { changeRule, formatPesoCents, pricePerLitre } from "@/lib/utils/vehicle-expenses";
import { OdometerDrums } from "./odometer-drums";

// The kinds whose odometer matters later (maintenance due, phase D).
const SERVICE_KINDS = new Set(["change_oil", "tires", "maintenance", "repair"]);
const num = (s: string) => (s.trim() === "" ? null : Number(s));

/** Log or change a fill-up ("fuel") or any other vehicle expense, with its receipt. */
export function ExpenseDialog({
  vehicle,
  mode,
  existing,
  needsReason = false,
  onClose,
}: {
  vehicle: Vehicle;
  mode: "fuel" | "expense";
  existing?: VehicleExpense;
  /** The Super Admin changing an entry after its day (changeRule "reason"). */
  needsReason?: boolean;
  onClose: () => void;
}) {
  const { kinds, logExpense, editExpense } = useVehicleExpenses();
  const { staffId } = useRole();
  const { staff } = useStaffRoster();
  const drivers = staff.filter((s) => s.active && (s.role === "driver" || s.extraRoles.includes("driver")));
  const fuel = mode === "fuel";
  const tracked = vehicle.startOdometer != null;

  const [kind, setKind] = React.useState(existing?.kind ?? (fuel ? "fuel" : ""));
  const [date, setDate] = React.useState(existing?.date ?? todayIso());
  const [amount, setAmount] = React.useState(existing?.amount.toString() ?? "");
  const [litres, setLitres] = React.useState(existing?.litres?.toString() ?? "");
  const [fullTank, setFullTank] = React.useState(existing?.fullTank ?? true);
  const [odometer, setOdometer] = React.useState<number | null>(existing ? existing.odometer : vehicle.lastReading);
  const [vendor, setVendor] = React.useState(existing?.vendor ?? "");
  const [notes, setNotes] = React.useState(existing?.notes ?? "");
  const [payer, setPayer] = React.useState(existing?.paidBy === "driver" ? (existing.paidByStaffId ?? "laf") : "laf");
  const [receipt, setReceipt] = React.useState<File | null>(null);
  const [reason, setReason] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const askOdometer = tracked && (fuel || SERVICE_KINDS.has(kind));
  const odometerProblem = askOdometer && fuel ? readingProblem(odometer, vehicle.startOdometer) : null;
  const perLitre = fuel ? pricePerLitre(Number(amount) || 0, num(litres)) : null;
  const problem =
    !kind ? "Choose what it was for." :
    !(Number(amount) > 0) ? "Enter the amount." :
    fuel && !(Number(litres) > 0) ? "Enter the litres." :
    date > todayIso() ? "The date can't be in the future." :
    odometerProblem ??
    (needsReason && reason.trim().length < 5 ? "Say why it is being changed." : null);

  async function save() {
    if (problem) return;
    setSaving(true);
    const input: ExpenseInput = {
      vehicleId: vehicle.id,
      date,
      kind,
      amount: Number(amount),
      litres: fuel ? num(litres) : null,
      fullTank: fuel ? fullTank : null,
      odometer: askOdometer ? odometer : null,
      vendor,
      notes,
      paidBy: payer === "laf" ? "laf" : "driver",
      paidByStaffId: payer === "laf" ? null : payer,
    };
    const r = existing
      ? await editExpense(existing.id, input, needsReason ? reason : undefined).then((x) => (x.ok ? { ok: true as const, id: existing.id } : x))
      : await logExpense(input);
    if (!r.ok) {
      setSaving(false);
      toast.error(r.error);
      return;
    }
    const id = r.id;
    if (receipt) {
      const up = await uploadFileToRecord("vehicle_expense", id, receipt);
      if (!up.ok) toast.warning(`Saved, but the receipt didn't upload (${up.error}). Add it from Receipts on the entry.`);
    }
    setSaving(false);
    toast.success(existing ? "Entry updated" : fuel ? "Fill-up logged" : "Expense logged");
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{existing ? "Change the entry" : fuel ? "Log fuel" : "Log an expense"}</DialogTitle>
          <DialogDescription>{vehicle.name}</DialogDescription>
        </DialogHeader>
        {!fuel && (
          <Field>
            <FieldLabel htmlFor="expKind">What for</FieldLabel>
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger id="expKind" className="w-full">
                <SelectValue placeholder="Select…" />
              </SelectTrigger>
              <SelectContent>
                {kinds.filter((k) => k.id !== "fuel").map((k) => (
                  <SelectItem key={k.id} value={k.id}>
                    {k.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          {fuel && (
            <Field>
              <FieldLabel htmlFor="expLitres">Litres</FieldLabel>
              <Input id="expLitres" type="number" inputMode="decimal" min="0.01" step="0.01" value={litres} onChange={(e) => setLitres(e.target.value)} />
            </Field>
          )}
          <Field>
            <FieldLabel htmlFor="expAmount">Amount (₱)</FieldLabel>
            <Input id="expAmount" type="number" inputMode="decimal" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="expDate">Date</FieldLabel>
            <Input id="expDate" type="date" max={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="expVendor">{fuel ? "Station" : "Shop"}</FieldLabel>
            <Input id="expVendor" value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder={fuel ? "e.g. Petron Timog" : "e.g. Rapide Cubao"} />
          </Field>
        </div>
        {fuel && (
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="expFull" className="text-theme-sm">
              Filled to full
              <span className="block text-theme-xs text-muted-foreground">Full-to-full fills measure km per litre.</span>
            </label>
            <Switch id="expFull" checked={fullTank} onCheckedChange={setFullTank} />
          </div>
        )}
        {perLitre != null && <p className="text-theme-xs text-muted-foreground tabular-nums">{formatPesoCents(perLitre)} per litre</p>}
        {askOdometer && (
          <Field className="items-center">
            <FieldLabel>Odometer {fuel ? "at the pump" : "at the shop"}</FieldLabel>
            <OdometerDrums value={odometer} onChange={setOdometer} />
            <FieldDescription className="text-center">
              {odometerProblem ?? (vehicle.lastReading != null ? `Last trip reading ${formatKm(vehicle.lastReading)}.` : "Check the dashboard.")}
            </FieldDescription>
          </Field>
        )}
        <Field>
          <FieldLabel htmlFor="expPayer">Paid by</FieldLabel>
          <Select value={payer} onValueChange={setPayer}>
            <SelectTrigger id="expPayer" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="laf">LAF (cash advance or LAF card)</SelectItem>
              {drivers.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.firstName} {d.lastName}
                  {d.id === staffId ? " (me)" : ""}, to be reimbursed
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="expNotes">Notes</FieldLabel>
          <Input id="expNotes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
        </Field>
        <Field>
          <FieldLabel htmlFor="expReceipt">Receipt</FieldLabel>
          <Input id="expReceipt" type="file" accept="image/*,application/pdf" capture="environment" onChange={(e) => setReceipt(e.target.files?.[0] ?? null)} />
          <FieldDescription>A photo of the receipt. More can be added later from the entry.</FieldDescription>
        </Field>
        {needsReason && (
          <Field>
            <FieldLabel htmlFor="expReason">Why it is being changed</FieldLabel>
            <Textarea id="expReason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        )}
        {problem && (amount || litres || reason) ? <p className="text-theme-xs text-destructive">{problem}</p> : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!!problem || saving} onClick={save}>
            {saving ? "Saving…" : existing ? "Save changes" : "Log it"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The last 30 days of fuel and expenses: receipts, same-day changes, voids. */
export function ExpensesList({ vehicles }: { vehicles: Vehicle[] }) {
  const { expenses, kindName, voidExpense } = useVehicleExpenses();
  const { staffId, roles } = useRole();
  const { staff } = useStaffRoster();
  const [editing, setEditing] = React.useState<VehicleExpense | null>(null);
  const [voiding, setVoiding] = React.useState<VehicleExpense | null>(null);
  const [receiptsFor, setReceiptsFor] = React.useState<VehicleExpense | null>(null);
  const isSuperAdmin = roles.includes("admin");
  const since = new Date(`${todayIso()}T00:00:00Z`);
  since.setUTCDate(since.getUTCDate() - 30);
  const recent = expenses.filter((e) => e.date >= since.toISOString().slice(0, 10));
  const name = (id: string | null) => {
    const s = staff.find((x) => x.id === id);
    return s ? `${s.firstName} ${s.lastName}` : "someone";
  };
  const vehicleOf = (id: string) => vehicles.find((v) => v.id === id);
  if (recent.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-medium text-foreground">Fuel &amp; expenses · last 30 days</h2>
      <div className="divide-y divide-border rounded-2xl border border-border bg-card">
        {recent.map((e) => {
          const rule = changeRule(e, staffId ?? null, isSuperAdmin);
          const perLitre = pricePerLitre(e.amount, e.litres);
          const Icon = e.kind === "fuel" ? Fuel : Wrench;
          return (
            <div key={e.id} className={`flex flex-col gap-1 px-5 py-3 ${e.voidedAt ? "opacity-60" : ""}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className={`flex items-center gap-2 text-theme-sm font-medium ${e.voidedAt ? "line-through" : ""}`}>
                  <Icon className="size-4 text-muted-foreground" />
                  {kindName(e.kind)} · {formatPesoCents(e.amount)}
                </span>
                <span className="flex items-center gap-1">
                  {e.paidBy === "driver" && !e.voidedAt && <Badge variant="outline">Owed to {name(e.paidByStaffId)}</Badge>}
                  {e.voidedAt && <Badge variant="secondary">Voided</Badge>}
                </span>
              </div>
              <span className="text-theme-xs text-muted-foreground tabular-nums">
                {formatDate(e.date, "EEE, MMM d")} · {vehicleOf(e.vehicleId)?.name ?? "Vehicle"}
                {e.litres != null ? ` · ${e.litres} L` : ""}
                {perLitre != null ? ` · ${formatPesoCents(perLitre)}/L` : ""}
                {e.fullTank ? " · full tank" : ""}
                {e.odometer != null ? ` · ${formatKm(e.odometer)}` : ""}
                {e.vendor ? ` · ${e.vendor}` : ""}
                {` · logged by ${name(e.loggedBy)}`}
              </span>
              {e.voidedAt && <span className="text-theme-xs text-muted-foreground">Voided: {e.voidReason}</span>}
              <div className="flex flex-wrap gap-1">
                <Button variant="ghost" size="sm" onClick={() => setReceiptsFor(e)}>
                  <Paperclip /> Receipts
                </Button>
                {rule !== "no" && (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => setEditing(e)}>
                      <Pencil /> Change
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setVoiding(e)}>
                      <Ban /> Void
                    </Button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {editing && vehicleOf(editing.vehicleId) && (
        <ExpenseDialog
          vehicle={vehicleOf(editing.vehicleId)!}
          mode={editing.kind === "fuel" ? "fuel" : "expense"}
          existing={editing}
          needsReason={changeRule(editing, staffId ?? null, isSuperAdmin) === "reason"}
          onClose={() => setEditing(null)}
        />
      )}
      <ReasonDialog
        open={voiding != null}
        onOpenChange={(o) => !o && setVoiding(null)}
        title="Void this entry?"
        description="It stays on the record, crossed out, with the reason. It no longer counts in the totals."
        confirmLabel="Void"
        destructive
        onConfirm={async (reason) => {
          if (!voiding) return;
          const r = await voidExpense(voiding.id, reason);
          if (r.ok) toast.success("Entry voided");
          else toast.error(r.error);
        }}
      />
      {receiptsFor && (
        <Dialog open onOpenChange={(o) => !o && setReceiptsFor(null)}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Receipts</DialogTitle>
              <DialogDescription>
                {kindName(receiptsFor.kind)} · {formatPesoCents(receiptsFor.amount)} · {formatDate(receiptsFor.date, "MMM d, yyyy")}
              </DialogDescription>
            </DialogHeader>
            <FileLibrary
              recordType="vehicle_expense"
              recordId={receiptsFor.id}
              canUpload={canUploadFiles("transport", roles, false) && !receiptsFor.voidedAt}
              canDelete={canDeleteFiles("transport", roles, false)}
              compact
            />
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}
