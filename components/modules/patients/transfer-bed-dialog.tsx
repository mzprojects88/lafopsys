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
import { BedRuleException, NO_EXCEPTION, exceptionFor, useBedChoices, type ExceptionDraft } from "@/components/modules/patients/bed-rule-fields";
import { usePatientsData } from "@/lib/hooks/use-patients-collection";
import { useHouseLayout } from "@/lib/hooks/use-house-layout-collection";
import { useBedNights } from "@/lib/hooks/use-bed-nights-collection";
import { sleeperOfStay } from "@/lib/utils/bed-rules";
import { unitForBedPosition } from "@/lib/utils/beds";
import type { Stay } from "@/lib/types/patient";
import { plainError } from "@/lib/utils/plain-error";

interface TransferBedDialogProps {
  stay: Stay | null;
  patientName: string;
  onOpenChange: (open: boolean) => void;
  onTransferred: () => void;
}

/**
 * Moves an active stay to another bed, now: the same database door as House
 * Today's "Move for tonight" (ops.confirm_night), so the bed rules (0070) and
 * tonight's bed both follow. The browser no longer writes a stay's bed itself.
 */
export function TransferBedDialog({ stay, patientName, onOpenChange, onTransferred }: TransferBedDialogProps) {
  const { carers, patients } = usePatientsData();
  const { units, bedPositions } = useHouseLayout();
  const { confirmNight } = useBedNights();
  const [unitId, setUnitId] = React.useState("");
  const [exception, setException] = React.useState<ExceptionDraft>(NO_EXCEPTION);
  const [submitting, setSubmitting] = React.useState(false);

  const currentUnit = stay ? unitForBedPosition(stay.bedPositionId, units, bedPositions) : undefined;
  const { options: beds, blocked, isException } = useBedChoices(
    { who: stay ? sleeperOfStay(stay, carers, patients) : {}, excludeUnitId: currentUnit?.id, ignoreStayId: stay?.id, patientId: stay?.patientId },
    exception
  );
  const reason = exceptionFor(isException(unitId), exception);

  async function handleConfirm() {
    const target = beds.find((b) => b.unit.id === unitId);
    if (!stay || !target) return;
    setSubmitting(true);
    const result = await confirmNight(stay.id, target.unit.id, reason);
    setSubmitting(false);
    if (!result.ok) {
      toast.error(`Couldn't change the bed: ${plainError(result.error)}`);
      return;
    }
    toast.success(`${patientName} transferred to ${target.unit.code}`);
    setUnitId("");
    setException(NO_EXCEPTION);
    onTransferred();
    onOpenChange(false);
  }

  return (
    <Dialog open={!!stay} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Transfer {patientName} to a New Bed</DialogTitle>
          <DialogDescription>Moves this active stay to a different available bed, from tonight.</DialogDescription>
        </DialogHeader>

        <Field>
          <FieldLabel>New bed</FieldLabel>
          <FloorPlanBedPicker value={unitId} onChange={setUnitId} options={beds} blocked={blocked} />
        </Field>
        <BedRuleException blocked={blocked} value={exception} onChange={setException} />

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!unitId || submitting || (isException(unitId) && !reason)} onClick={handleConfirm}>
            {submitting ? "Transferring…" : "Confirm Transfer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
