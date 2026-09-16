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
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { usePatientsData } from "@/lib/hooks/use-patients-collection";
import { useHouseLayout } from "@/lib/hooks/use-house-layout-collection";
import { assignableBeds } from "@/lib/utils/beds";
import { TODAY_ISO } from "@/lib/utils/seeded-random";
import type { Referral } from "@/lib/types/patient";

interface ConfirmArrivalDialogProps {
  referral: Referral | null;
  onOpenChange: (open: boolean) => void;
  onAdmitted: (patientId: string) => void;
}

export function ConfirmArrivalDialog({ referral, onOpenChange, onAdmitted }: ConfirmArrivalDialogProps) {
  const { stays, addPatient, addCarer, addStay } = usePatientsData();
  const { rooms, units, bedPositions } = useHouseLayout();
  const [unitId, setUnitId] = React.useState<string>("");
  const [submitting, setSubmitting] = React.useState(false);

  // The beds drawn on the floor plan, minus the locked and the full ones;
  // each comes with the position the admission would take (0047).
  const beds = assignableBeds(units, bedPositions, stays, rooms);
  const unplaced = beds.filter((b) => b.unit.x === null).length;

  async function handleConfirm() {
    const target = beds.find((b) => b.unit.id === unitId);
    if (!referral || !target) return;
    const bedPositionId = target.position.id;
    setSubmitting(true);

    const patientId = crypto.randomUUID();
    const carerId = crypto.randomUUID();

    const patientResult = await addPatient({
      id: patientId,
      patientNumber: `REF-${referral.id}`,
      firstName: referral.patientFirstName ?? referral.patientName.split(" ")[0],
      lastName: referral.patientLastName ?? referral.patientName.split(" ").slice(1).join(" "),
      birthDate: referral.patientBirthDate,
      sex: referral.patientSex ?? "M",
      provinceId: referral.provinceId ?? "",
      rawAddress: referral.rawAddress,
      diagnosisIds: referral.diagnosisIds ?? [],
      treatmentPhaseId: referral.treatmentPhaseId ?? "",
      status: "ongoing",
      carerIds: referral.carerName ? [carerId] : [],
      admittedAt: TODAY_ISO,
      referringHospitalId: referral.hospitalId,
    });
    if (!patientResult.ok) {
      toast.error(`Couldn't create the patient record: ${patientResult.error}`);
      setSubmitting(false);
      return;
    }

    if (referral.carerName) {
      const carerResult = await addCarer({
        id: carerId,
        patientId,
        name: referral.carerName,
        relationship: referral.carerRelationship ?? "Guardian",
        mobileNumber: referral.carerMobile ?? "",
        effectiveFrom: TODAY_ISO,
      });
      if (!carerResult.ok) {
        toast.error(`Patient created, but couldn't save the carer: ${carerResult.error}`);
        setSubmitting(false);
        return;
      }
    }

    const stayResult = await addStay({
      id: crypto.randomUUID(),
      patientId,
      bedPositionId,
      carerId: referral.carerName ? carerId : undefined,
      checkInAt: TODAY_ISO,
      status: "in_house",
    });
    if (!stayResult.ok) {
      toast.error(`Patient created, but couldn't check them into the bed: ${stayResult.error}`);
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    onAdmitted(patientId);
    setUnitId("");
    onOpenChange(false);
  }

  return (
    <Dialog open={!!referral} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Confirm Arrival & Admit</DialogTitle>
          <DialogDescription>
            {referral?.patientName} has physically arrived at LAF House. Assign a bed to complete the admission —
            this creates their patient record and check-in.
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="bed">Bed</FieldLabel>
          <Select value={unitId} onValueChange={setUnitId}>
            <SelectTrigger id="bed" className="w-full">
              <SelectValue placeholder={beds.length ? "Select an available bed" : "No beds available"} />
            </SelectTrigger>
            <SelectContent>
              {beds.map((b) => (
                <SelectItem key={b.unit.id} value={b.unit.id}>
                  {b.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {unplaced > 0 && (
            <FieldDescription>
              {unplaced} {unplaced === 1 ? "bed is" : "beds are"} not yet placed on the floor plan.
            </FieldDescription>
          )}
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!unitId || submitting} onClick={handleConfirm}>
            {submitting ? "Admitting…" : "Confirm & Admit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
