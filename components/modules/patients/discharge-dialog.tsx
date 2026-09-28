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
import { todayIso } from "@/lib/utils/date";
import type { Stay } from "@/lib/types/patient";
import { plainError } from "@/lib/utils/plain-error";

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
  /** Pre-filled check-out day, e.g. the day after a child left NCH's sheet (0051). Defaults to today. */
  defaultCheckOutAt?: string;
}

export function DischargeDialog({ stay, patientName, onOpenChange, onDischarged, defaultCheckOutAt }: DischargeDialogProps) {
  const { updateStay, addAppointment } = usePatientsData();
  const [reason, setReason] = React.useState<string>("");
  const [destination, setDestination] = React.useState("");
  const [checkOutAtInput, setCheckOutAtInput] = React.useState("");
  const checkOutAt = checkOutAtInput || defaultCheckOutAt || todayIso();
  const [scheduleFollowUp, setScheduleFollowUp] = React.useState(false);
  const [followUpDate, setFollowUpDate] = React.useState("");
  const [followUpClinic, setFollowUpClinic] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  function reset() {
    setReason("");
    setDestination("");
    setCheckOutAtInput("");
    setScheduleFollowUp(false);
    setFollowUpDate("");
    setFollowUpClinic("");
  }

  async function handleConfirm() {
    if (!stay || !reason) return;
    setSubmitting(true);

    const result = await updateStay(stay.id, {
      checkOutAt,
      checkOutReason: reason,
      destination: destination || undefined,
      followUpDate: scheduleFollowUp && followUpDate ? followUpDate : undefined,
      status: "checked_out",
    });
    if (!result.ok) {
      toast.error(`Couldn't check out: ${plainError(result.error)}`);
      setSubmitting(false);
      return;
    }

    if (scheduleFollowUp && followUpDate) {
      const apptResult = await addAppointment({
        id: crypto.randomUUID(),
        patientId: stay.patientId,
        date: followUpDate,
        time: "09:00",
        clinic: followUpClinic.trim() || "Follow-up (set clinic on the Appointments page)",
        purpose: "Follow-up after check-out",
        needsTransport: false,
      });
      if (!apptResult.ok) {
        toast.error(`Checked out, but couldn't schedule the follow-up: ${plainError(apptResult.error)}`);
        setSubmitting(false);
        reset();
        onDischarged();
        onOpenChange(false);
        return;
      }
    }

    toast.success(`${patientName} checked out`);
    setSubmitting(false);
    reset();
    onDischarged();
    onOpenChange(false);
  }

  return (
    <Dialog open={!!stay} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Check out {patientName}</DialogTitle>
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
          <FieldLabel htmlFor="checkOutAt">Checked out on</FieldLabel>
          <Input
            id="checkOutAt"
            type="date"
            min={stay?.checkInAt}
            max={todayIso()}
            value={checkOutAt}
            onChange={(e) => setCheckOutAtInput(e.target.value)}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="destination">Destination (optional)</FieldLabel>
          <Input id="destination" placeholder="e.g. Home, referring hospital" value={destination} onChange={(e) => setDestination(e.target.value)} />
        </Field>

        <label className="flex items-center gap-2 text-theme-sm">
          <Checkbox checked={scheduleFollowUp} onCheckedChange={(v) => setScheduleFollowUp(!!v)} />
          Schedule a follow-up appointment
        </label>

        {scheduleFollowUp && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="followUpDate">Follow-up date</FieldLabel>
              <Input id="followUpDate" type="date" min={checkOutAt} value={followUpDate} onChange={(e) => setFollowUpDate(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="followUpClinic">Clinic (optional)</FieldLabel>
              <Input id="followUpClinic" placeholder="e.g. NCH Pediatric Oncology" value={followUpClinic} onChange={(e) => setFollowUpClinic(e.target.value)} />
            </Field>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!reason || !checkOutAt || submitting} onClick={handleConfirm}>
            {submitting ? "Checking out…" : "Check out"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
