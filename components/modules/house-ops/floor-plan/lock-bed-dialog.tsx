"use client";

import * as React from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { UnitStatus } from "@/lib/types/house-ops";
import type { BedView } from "./bed-view";

type LockStatus = Exclude<UnitStatus, "available">;

interface LockBedDialogProps {
  bed: BedView | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (status: LockStatus, reason: string) => Promise<void>;
}

/** Takes a bed out of the admission list with a reason (0047 requires one). */
export function LockBedDialog({ bed, onOpenChange, onConfirm }: LockBedDialogProps) {
  const [status, setStatus] = React.useState<LockStatus>("maintenance");
  const [reason, setReason] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (bed) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting the form for the bed just opened
      setStatus(bed.status === "blocked" ? "blocked" : "maintenance");
      setReason(bed.lockReason ?? "");
    }
  }, [bed]);

  async function handleConfirm() {
    if (!reason.trim()) return;
    setSubmitting(true);
    await onConfirm(status, reason.trim());
    setSubmitting(false);
  }

  return (
    <Dialog open={!!bed} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Lock bed {bed?.code}</DialogTitle>
          <DialogDescription>
            A locked bed is not offered for admission until it is unlocked. Anyone already in it stays until transferred or
            discharged.
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="lock-status">Lock as</FieldLabel>
          <Select value={status} onValueChange={(v) => setStatus(v as LockStatus)}>
            <SelectTrigger id="lock-status" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="maintenance">Maintenance — repair, cleaning, replacement</SelectItem>
              <SelectItem value="blocked">Blocked — not to be used for now</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="lock-reason">Reason</FieldLabel>
          <Textarea
            id="lock-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Broken slat, carpenter booked for Monday"
            rows={3}
          />
          <FieldDescription>Shown to everyone who hovers the bed, with your name and the date.</FieldDescription>
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={submitting || !reason.trim()}>
            {submitting ? "Locking…" : "Lock bed"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
