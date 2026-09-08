"use client";

import * as React from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Field, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { leaveRequestsStore } from "@/lib/hooks/use-leave-collections";
import { submitLeaveRequest, type LeaveRequestInput } from "@/app/(app)/hr/leave/actions";
import type { Employee, LeaveType } from "@/lib/types/hr";
import { employeeFullName } from "@/lib/types/hr";

/**
 * File a leave request -- for yourself, or (HR) for someone else. The
 * server computes the days over the person's schedule and checks
 * eligibility and balance, so the dialog only collects the facts.
 */
export function LeaveRequestDialog({ leaveTypes, employees, forEmployee, hr }: { leaveTypes: LeaveType[]; employees: Employee[]; forEmployee: Employee | null; hr: boolean }) {
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const types = leaveTypes.filter((t) => t.active);
  const blank = (): LeaveRequestInput => ({ employeeId: forEmployee?.id ?? null, leaveTypeId: types[0]?.id ?? "vl", startsOn: "", endsOn: "", startHalf: false, endHalf: false, reason: "", documentUrl: "" });
  const [form, setForm] = React.useState<LeaveRequestInput>(blank);
  const type = types.find((t) => t.id === form.leaveTypeId);

  async function handleSave() {
    setSaving(true);
    const result = await submitLeaveRequest(form);
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    await leaveRequestsStore.refetch();
    toast.success(`Request filed: ${result.data?.days} day(s).`);
    setOpen(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setForm(blank());
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="size-3.5" />
          Request leave
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request leave</DialogTitle>
          <DialogDescription>Days are counted over scheduled workdays only; rest days and holidays in between are not charged.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {hr ? (
            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="lr-emp">Employee</FieldLabel>
              <Select value={form.employeeId ?? ""} onValueChange={(v) => setForm({ ...form, employeeId: v })}>
                <SelectTrigger id="lr-emp" className="w-full">
                  <SelectValue placeholder="Choose" />
                </SelectTrigger>
                <SelectContent>
                  {employees
                    .filter((e) => e.status === "active" || e.status === "on_leave")
                    .map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {employeeFullName(e)}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="lr-type">Leave type</FieldLabel>
            <Select value={form.leaveTypeId} onValueChange={(v) => setForm({ ...form, leaveTypeId: v })}>
              <SelectTrigger id="lr-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {types.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                    {t.paid ? "" : " (unpaid)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {type?.lawRef ? <p className="text-xs text-muted-foreground">{type.lawRef}</p> : null}
          </Field>
          <Field>
            <FieldLabel htmlFor="lr-from">From</FieldLabel>
            <Input id="lr-from" type="date" value={form.startsOn} onChange={(e) => setForm({ ...form, startsOn: e.target.value, endsOn: form.endsOn || e.target.value })} />
          </Field>
          <Field>
            <FieldLabel htmlFor="lr-to">To</FieldLabel>
            <Input id="lr-to" type="date" value={form.endsOn} min={form.startsOn} onChange={(e) => setForm({ ...form, endsOn: e.target.value })} />
          </Field>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm">First day is a half day</span>
            <Switch checked={form.startHalf} onCheckedChange={(v) => setForm({ ...form, startHalf: v })} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm">Last day is a half day</span>
            <Switch checked={form.endHalf} onCheckedChange={(v) => setForm({ ...form, endHalf: v })} disabled={form.startsOn === form.endsOn} />
          </div>
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="lr-reason">Reason</FieldLabel>
            <Textarea id="lr-reason" rows={2} value={form.reason ?? ""} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </Field>
          {type?.requiresDocument ? (
            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="lr-doc">Supporting document (link)</FieldLabel>
              <Input id="lr-doc" value={form.documentUrl ?? ""} onChange={(e) => setForm({ ...form, documentUrl: e.target.value })} placeholder="https://drive.google.com/…" />
              <p className="text-xs text-muted-foreground">Medical certificate, Solo Parent ID, protection order — whatever the law asks for.</p>
            </Field>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !form.startsOn || !form.endsOn}>
            {saving ? "Filing…" : "File request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
