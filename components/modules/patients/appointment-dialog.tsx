"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { usePatientsData } from "@/lib/hooks/use-patients-collection";
import type { Appointment } from "@/lib/types/patient";
import { todayIso } from "@/lib/utils/date";
import { plainError } from "@/lib/utils/plain-error";

/**
 * Adds or corrects a check-up (0097): the social worker's interview -- when the next check-up is
 * and whether the family needs a ride. "Needs a ride" puts the child on Patients > Manifest.
 */
export function AppointmentDialog({ patientId, appointment, onClose }: { patientId: string; appointment: Appointment | null; onClose: () => void }) {
  const { addAppointment, updateAppointment, removeAppointment } = usePatientsData();
  const [date, setDate] = React.useState(appointment?.date ?? todayIso());
  const [time, setTime] = React.useState(appointment?.time ?? "09:00");
  const [clinic, setClinic] = React.useState(appointment?.clinic ?? "");
  const [purpose, setPurpose] = React.useState(appointment?.purpose ?? "Check-up");
  const [needsRide, setNeedsRide] = React.useState(appointment?.needsTransport ?? false);
  const [saving, setSaving] = React.useState(false);

  async function act(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string) {
    setSaving(true);
    const r = await fn();
    setSaving(false);
    if (!r.ok) {
      toast.error(plainError(r.error));
      return;
    }
    toast.success(done);
    onClose();
  }

  const fields = { date, time, clinic: clinic.trim(), purpose: purpose.trim(), needsTransport: needsRide };
  const save = () =>
    act(
      () => (appointment ? updateAppointment(appointment.id, fields) : addAppointment({ id: crypto.randomUUID(), patientId, ...fields })),
      appointment ? "Appointment saved" : "Appointment added"
    );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{appointment ? "Appointment" : "New appointment"}</DialogTitle>
          <DialogDescription>The next check-up at the hospital, and whether the family needs a ride there.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel htmlFor="apptDate">Day</FieldLabel>
            <Input id="apptDate" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="apptTime">Time</FieldLabel>
            <Input id="apptTime" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor="apptClinic">Clinic</FieldLabel>
          <Input id="apptClinic" value={clinic} maxLength={120} placeholder="e.g. NCH Hematology OPD" onChange={(e) => setClinic(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="apptPurpose">Purpose</FieldLabel>
          <Input id="apptPurpose" value={purpose} maxLength={120} onChange={(e) => setPurpose(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-theme-sm">
          <Checkbox checked={needsRide} onCheckedChange={(v) => setNeedsRide(!!v)} />
          Needs a ride on HOPE in Transit
        </label>
        {appointment && (
          <FieldDescription>An appointment read from NCH&apos;s sheet takes the sheet&apos;s date again when the sheet changes.</FieldDescription>
        )}
        <DialogFooter className="gap-2 sm:justify-between">
          {appointment ? (
            <Button variant="outline" className="text-destructive" disabled={saving} onClick={() => act(() => removeAppointment(appointment.id), "Appointment removed")}>
              Remove
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={!date || !time || !fields.clinic || !fields.purpose || saving} onClick={save}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
