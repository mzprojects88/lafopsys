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
import { Field, FieldLabel } from "@/components/ui/field";
import { usePatientsData } from "@/lib/hooks/use-patients-collection";
import type { Stay } from "@/lib/types/patient";

interface ExtendStayDialogProps {
  stay: Stay | null;
  patientName: string;
  onOpenChange: (open: boolean) => void;
  onExtended: () => void;
}

export function ExtendStayDialog({ stay, patientName, onOpenChange, onExtended }: ExtendStayDialogProps) {
  const { updateStay } = usePatientsData();
  const [expectedCheckoutAt, setExpectedCheckoutAt] = React.useState(stay?.expectedCheckoutAt ?? "");
  const [submitting, setSubmitting] = React.useState(false);

  async function handleConfirm() {
    if (!stay || !expectedCheckoutAt) return;
    setSubmitting(true);
    const result = await updateStay(stay.id, { expectedCheckoutAt, status: "in_house" });
    setSubmitting(false);
    if (!result.ok) {
      toast.error(`Couldn't extend the stay: ${result.error}`);
      return;
    }
    toast.success(`${patientName}'s stay extended`);
    onExtended();
    onOpenChange(false);
  }

  return (
    <Dialog open={!!stay} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Extend {patientName}&apos;s Stay</DialogTitle>
          <DialogDescription>Updates the expected check-out date and clears any overdue flag.</DialogDescription>
        </DialogHeader>

        <Field>
          <FieldLabel htmlFor="expectedCheckoutAt">New expected check-out date</FieldLabel>
          <Input
            id="expectedCheckoutAt"
            type="date"
            value={expectedCheckoutAt}
            onChange={(e) => setExpectedCheckoutAt(e.target.value)}
          />
        </Field>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!expectedCheckoutAt || submitting} onClick={handleConfirm}>
            {submitting ? "Saving…" : "Extend Stay"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
