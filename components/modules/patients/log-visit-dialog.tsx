"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { usePatientsData } from "@/lib/hooks/use-patients-collection";

const PURPOSES = ["Chemo cycle", "Follow-up check-up", "Lab work", "Transfusion", "Consult", "Other procedure"];
const CLINICS = ["Pediatric Oncology Clinic", "Hematology Clinic", "Radiology", "Chemo Day Ward"];

interface LogVisitDialogProps {
  patientId: string | null;
  patientName?: string;
  onOpenChange: (open: boolean) => void;
  onLogged: () => void;
}

export function LogVisitDialog({ patientId, patientName, onOpenChange, onLogged }: LogVisitDialogProps) {
  const { addAppointment } = usePatientsData();
  const [date, setDate] = React.useState("");
  const [time, setTime] = React.useState("09:00");
  const [clinic, setClinic] = React.useState(CLINICS[0]);
  const [purpose, setPurpose] = React.useState(PURPOSES[0]);
  const [needsTransport, setNeedsTransport] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  function reset() {
    setDate("");
    setTime("09:00");
    setClinic(CLINICS[0]);
    setPurpose(PURPOSES[0]);
    setNeedsTransport(false);
  }

  async function handleConfirm() {
    if (!patientId || !date) return;
    setSubmitting(true);

    const result = await addAppointment({
      id: crypto.randomUUID(),
      patientId,
      date,
      time,
      clinic,
      purpose,
      needsTransport,
    });
    setSubmitting(false);

    if (!result.ok) {
      toast.error(`Couldn't log the visit: ${result.error}`);
      return;
    }

    onLogged();
    reset();
    onOpenChange(false);
  }

  return (
    <Dialog open={!!patientId} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Log Next Visit</DialogTitle>
          <DialogDescription>Schedule {patientName ?? "this patient"}&apos;s next hospital visit.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="visitDate">Date</FieldLabel>
            <Input id="visitDate" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="visitTime">Time</FieldLabel>
            <Input id="visitTime" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
        </div>

        <Field>
          <FieldLabel htmlFor="visitClinic">Clinic</FieldLabel>
          <Select value={clinic} onValueChange={setClinic}>
            <SelectTrigger id="visitClinic" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CLINICS.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <FieldLabel htmlFor="visitPurpose">Purpose</FieldLabel>
          <Select value={purpose} onValueChange={setPurpose}>
            <SelectTrigger id="visitPurpose" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PURPOSES.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={needsTransport} onCheckedChange={(v) => setNeedsTransport(!!v)} />
          Needs transport from LAF House
        </label>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!date || submitting} onClick={handleConfirm}>
            {submitting ? "Logging…" : "Log Visit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
