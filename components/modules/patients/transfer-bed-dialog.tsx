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
import { Field, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { units, bedPositions, rooms } from "@/lib/mock-data";
import { usePatientsData } from "@/lib/hooks/use-patients-collection";
import type { Stay } from "@/lib/types/patient";

interface TransferBedDialogProps {
  stay: Stay | null;
  patientName: string;
  onOpenChange: (open: boolean) => void;
  onTransferred: () => void;
}

export function TransferBedDialog({ stay, patientName, onOpenChange, onTransferred }: TransferBedDialogProps) {
  const { stays, updateStay } = usePatientsData();
  const [bedPositionId, setBedPositionId] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  // Same "genuinely free" computation as ConfirmArrivalDialog -- unit not under
  // maintenance/blocked AND no other active stay already references that bed.
  const availablePositions = bedPositions.filter((pos) => {
    if (pos.id === stay?.bedPositionId) return false;
    const unit = units.find((u) => u.id === pos.unitId);
    if (!unit || unit.status === "maintenance" || unit.status === "blocked") return false;
    const occupied = stays.some((s) => s.bedPositionId === pos.id && (s.status === "in_house" || s.status === "overdue"));
    return !occupied;
  });

  function unitLabel(unitId: string) {
    const unit = units.find((u) => u.id === unitId);
    const room = unit ? rooms.find((r) => r.id === unit.roomId) : undefined;
    return unit ? `${unit.code} · ${room?.name ?? ""}` : "";
  }

  async function handleConfirm() {
    if (!stay || !bedPositionId) return;
    setSubmitting(true);
    const result = await updateStay(stay.id, { bedPositionId });
    setSubmitting(false);
    if (!result.ok) {
      toast.error(`Couldn't transfer the bed: ${result.error}`);
      return;
    }
    toast.success(`${patientName} transferred to a new bed`);
    setBedPositionId("");
    onTransferred();
    onOpenChange(false);
  }

  return (
    <Dialog open={!!stay} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Transfer {patientName} to a New Bed</DialogTitle>
          <DialogDescription>Moves this active stay to a different available bed.</DialogDescription>
        </DialogHeader>

        <Field>
          <FieldLabel htmlFor="newBed">New bed position</FieldLabel>
          <Select value={bedPositionId} onValueChange={setBedPositionId}>
            <SelectTrigger id="newBed" className="w-full">
              <SelectValue placeholder={availablePositions.length ? "Select an available bed" : "No beds available"} />
            </SelectTrigger>
            <SelectContent>
              {availablePositions.map((pos) => (
                <SelectItem key={pos.id} value={pos.id}>
                  {unitLabel(pos.unitId)} — Bed {pos.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!bedPositionId || submitting} onClick={handleConfirm}>
            {submitting ? "Transferring…" : "Confirm Transfer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
