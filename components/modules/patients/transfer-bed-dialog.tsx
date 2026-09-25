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
import { FloorPlanBedPicker } from "@/components/modules/house-ops/floor-plan/floor-plan-bed-picker";
import { usePatientsData } from "@/lib/hooks/use-patients-collection";
import { useHouseLayout } from "@/lib/hooks/use-house-layout-collection";
import { useBedReservations } from "@/lib/hooks/use-bed-reservations";
import { assignableBeds, unitForBedPosition } from "@/lib/utils/beds";
import type { Stay } from "@/lib/types/patient";

interface TransferBedDialogProps {
  stay: Stay | null;
  patientName: string;
  onOpenChange: (open: boolean) => void;
  onTransferred: () => void;
}

export function TransferBedDialog({ stay, patientName, onOpenChange, onTransferred }: TransferBedDialogProps) {
  const { stays, updateStay } = usePatientsData();
  const { rooms, units, bedPositions } = useHouseLayout();
  const [unitId, setUnitId] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  // Same rule as CheckInDialog (lib/utils/beds.ts), minus the bed the
  // patient is already in.
  const currentUnit = stay ? unitForBedPosition(stay.bedPositionId, units, bedPositions) : undefined;
  const { reservations } = useBedReservations();
  const beds = assignableBeds(units, bedPositions, stays, rooms, { excludeUnitId: currentUnit?.id, holds: reservations });

  async function handleConfirm() {
    const target = beds.find((b) => b.unit.id === unitId);
    if (!stay || !target) return;
    setSubmitting(true);
    const result = await updateStay(stay.id, { bedPositionId: target.position.id });
    setSubmitting(false);
    if (!result.ok) {
      toast.error(`Couldn't transfer the bed: ${result.error}`);
      return;
    }
    toast.success(`${patientName} transferred to ${target.unit.code}`);
    setUnitId("");
    onTransferred();
    onOpenChange(false);
  }

  return (
    <Dialog open={!!stay} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Transfer {patientName} to a New Bed</DialogTitle>
          <DialogDescription>Moves this active stay to a different available bed.</DialogDescription>
        </DialogHeader>

        <Field>
          <FieldLabel>New bed</FieldLabel>
          <FloorPlanBedPicker value={unitId} onChange={setUnitId} options={beds} />
        </Field>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!unitId || submitting} onClick={handleConfirm}>
            {submitting ? "Transferring…" : "Confirm Transfer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
