"use client";

import * as React from "react";
import { toast } from "sonner";
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
import { usePatientsData } from "@/lib/hooks/use-patients-collection";
import { TODAY_ISO } from "@/lib/utils/seeded-random";
import type { Stay } from "@/lib/types/patient";

// Org-confirmed candidate list (2026-08-18) — the plan's proposed categories,
// signed off as the real ones to use.
export const CHECKOUT_REASONS = [
  { value: "completed_treatment", label: "Completed Treatment" },
  { value: "transferred", label: "Transferred" },
  { value: "deceased", label: "Deceased" },
  { value: "lost_to_follow_up", label: "Lost to Follow-up" },
  { value: "other", label: "Other" },
] as const;

interface DischargeDialogProps {
  stay: Stay | null;
  patientName: string;
  onOpenChange: (open: boolean) => void;
  onDischarged: () => void;
}

export function DischargeDialog({ stay, patientName, onOpenChange, onDischarged }: DischargeDialogProps) {
  const { updateStay, addAppointment } = usePatientsData();
  const [reason, setReason] = React.useState<string>("");
  const [destination, setDestination] = React.useState("");
  const [scheduleFollowUp, setScheduleFollowUp] = React.useState(false);
  const [followUpDate, setFollowUpDate] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  function reset() {
    setReason("");
    setDestination("");
    setScheduleFollowUp(false);
    setFollowUpDate("");
  }

  async function handleConfirm() {
    if (!stay || !reason) return;
    setSubmitting(true);

    const result = await updateStay(stay.id, {
      checkOutAt: TODAY_ISO,
      checkOutReason: reason,
      destination: destination || undefined,
      followUpDate: scheduleFollowUp && followUpDate ? followUpDate : undefined,
      status: "checked_out",
    });
    if (!result.ok) {
      toast.error(`Couldn't discharge: ${result.error}`);
      setSubmitting(false);
      return;
    }

    if (scheduleFollowUp && followUpDate) {
      const apptResult = await addAppointment({
        id: crypto.randomUUID(),
        patientId: stay.patientId,
        date: followUpDate,
        time: "09:00",
        clinic: "Follow-up (set clinic on the Appointments page)",
        purpose: "Post-discharge follow-up",
        needsTransport: false,
      });
      if (!apptResult.ok) {
        toast.error(`Discharged, but couldn't schedule the follow-up: ${apptResult.error}`);
        setSubmitting(false);
        reset();
        onDischarged();
        onOpenChange(false);
        return;
      }
    }

    toast.success(`${patientName} discharged`);
    setSubmitting(false);
    reset();
    onDischarged();
    onOpenChange(false);
  }

  return (
    <Dialog open={!!stay} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Discharge {patientName}</DialogTitle>
          <DialogDescription>Records the check-out and frees this bed for the next admission.</DialogDescription>
        </DialogHeader>

        <Field>
          <FieldLabel htmlFor="checkoutReason">Reason</FieldLabel>
          <Select value={reason} onValueChange={setReason}>
            <SelectTrigger id="checkoutReason" className="w-full">
              <SelectValue placeholder="Select a reason" />
            </SelectTrigger>
            <SelectContent>
              {CHECKOUT_REASONS.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <FieldLabel htmlFor="destination">Destination (optional)</FieldLabel>
          <Input id="destination" placeholder="e.g. Home, referring hospital" value={destination} onChange={(e) => setDestination(e.target.value)} />
        </Field>

        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={scheduleFollowUp} onCheckedChange={(v) => setScheduleFollowUp(!!v)} />
          Schedule a follow-up appointment
        </label>

        {scheduleFollowUp && (
          <Field>
            <FieldLabel htmlFor="followUpDate">Follow-up date</FieldLabel>
            <Input id="followUpDate" type="date" value={followUpDate} onChange={(e) => setFollowUpDate(e.target.value)} />
          </Field>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!reason || submitting} onClick={handleConfirm}>
            {submitting ? "Discharging…" : "Confirm Discharge"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
