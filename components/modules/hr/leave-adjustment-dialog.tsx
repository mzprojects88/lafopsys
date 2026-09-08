"use client";

import * as React from "react";
import { toast } from "sonner";
import { SlidersHorizontal } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { leaveAdjustmentsStore } from "@/lib/hooks/use-leave-collections";
import { addLeaveAdjustment } from "@/app/(app)/hr/leave/actions";
import { employeeFullName, type Employee, type LeaveAdjustmentKind, type LeaveType } from "@/lib/types/hr";

const KINDS: { value: LeaveAdjustmentKind; label: string; hint: string }[] = [
  { value: "opening", label: "Opening balance", hint: "Days owed from before the system (go-live)." },
  { value: "carry_in", label: "Carry-in", hint: "Unused days brought into this year." },
  { value: "conversion", label: "Cash conversion", hint: "Days paid out (removed from the balance)." },
  { value: "forfeit", label: "Forfeited", hint: "Days lost (removed from the balance)." },
  { value: "manual", label: "Correction", hint: "Any other adjustment; say why." },
];

/** HR corrects a balance. Every row keeps its note -- adjustments are audited. */
export function LeaveAdjustmentDialog({ employee, leaveTypes, year }: { employee: Employee; leaveTypes: LeaveType[]; year: number }) {
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const accruing = leaveTypes.filter((t) => t.paid && !t.eligibility.perEvent);
  const [form, setForm] = React.useState({ leaveTypeId: accruing[0]?.id ?? "vl", year, kind: "opening" as LeaveAdjustmentKind, days: 0, note: "" });

  async function handleSave() {
    setSaving(true);
    const result = await addLeaveAdjustment({ employeeId: employee.id, ...form });
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    await leaveAdjustmentsStore.refetch();
    toast.success("Balance adjusted.");
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5">
          <SlidersHorizontal className="size-3.5" />
          Adjust balance
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adjust {employeeFullName(employee)}&apos;s balance</DialogTitle>
          <DialogDescription>Conversions and forfeits are entered as positive days and subtracted.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="la-type">Leave type</FieldLabel>
            <Select value={form.leaveTypeId} onValueChange={(v) => setForm({ ...form, leaveTypeId: v })}>
              <SelectTrigger id="la-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {accruing.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="la-year">Year</FieldLabel>
            <Input id="la-year" type="number" value={form.year} onChange={(e) => setForm({ ...form, year: Number(e.target.value) })} />
          </Field>
          <Field>
            <FieldLabel htmlFor="la-kind">Kind</FieldLabel>
            <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v as LeaveAdjustmentKind })}>
              <SelectTrigger id="la-kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KINDS.map((k) => (
                  <SelectItem key={k.value} value={k.value}>
                    {k.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{KINDS.find((k) => k.value === form.kind)?.hint}</p>
          </Field>
          <Field>
            <FieldLabel htmlFor="la-days">Days</FieldLabel>
            <Input id="la-days" type="number" step="0.5" value={form.days} onChange={(e) => setForm({ ...form, days: Number(e.target.value) })} />
          </Field>
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="la-note">Note (required)</FieldLabel>
            <Input id="la-note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Balance per the old leave card as of go-live…" />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
