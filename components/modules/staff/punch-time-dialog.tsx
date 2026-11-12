"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export interface PunchTimeValue {
  staffId: string;
  date: string;
  time: string;
  /** Add punch only: the clock-out, if known. */
  outTime: string;
  reason: string;
}

/**
 * One small form for every punch time on the Punches page (0146): add a clock-out, change a time, ask for a missed
 * clock-out, or (with `staff`) add a punch with an optional clock-out. Always a reason, at least 3 characters; the
 * caller saves and says whether it worked (the dialog then closes).
 */
export function PunchTimeDialog({
  title,
  description,
  confirmLabel,
  date: date0,
  time: time0 = "",
  staff,
  onClose,
  onSubmit,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  date: string;
  time?: string;
  staff?: { id: string; name: string }[];
  onClose: () => void;
  onSubmit: (v: PunchTimeValue) => Promise<boolean>;
}) {
  const [v, setV] = React.useState<PunchTimeValue>({ staffId: "", date: date0, time: time0, outTime: "", reason: "" });
  const [busy, setBusy] = React.useState(false);
  const set = (k: keyof PunchTimeValue) => (value: string) => setV((o) => ({ ...o, [k]: value }));
  const ready = (!staff || v.staffId) && v.date && v.time && v.reason.trim().length >= 3;

  async function submit() {
    setBusy(true);
    const ok = await onSubmit({ ...v, reason: v.reason.trim() });
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {staff ? (
            <Field className="sm:col-span-2">
              <FieldLabel>Staff</FieldLabel>
              <Select value={v.staffId} onValueChange={set("staffId")}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Who" /></SelectTrigger>
                <SelectContent>
                  {staff.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          ) : null}
          <Field>
            <FieldLabel htmlFor="punch-date">Day</FieldLabel>
            <Input id="punch-date" type="date" value={v.date} onChange={(e) => set("date")(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="punch-time">{staff ? "IN" : "Time"}</FieldLabel>
            <Input id="punch-time" type="time" value={v.time} onChange={(e) => set("time")(e.target.value)} />
          </Field>
          {staff ? (
            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="punch-out">OUT (if known)</FieldLabel>
              <Input id="punch-out" type="time" value={v.outTime} onChange={(e) => set("outTime")(e.target.value)} />
              <FieldDescription>An OUT earlier than the IN is the next morning.</FieldDescription>
            </Field>
          ) : null}
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="punch-reason">Reason</FieldLabel>
            <Textarea id="punch-reason" rows={2} value={v.reason} onChange={(e) => set("reason")(e.target.value)} placeholder="Why (kept with the record)" />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !ready} onClick={() => void submit()}>{busy ? "Saving…" : confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
