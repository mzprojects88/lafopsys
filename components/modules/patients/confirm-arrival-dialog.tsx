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
import { Field, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { units, bedPositions, rooms } from "@/lib/mock-data";
import { usePatientsData } from "@/lib/hooks/use-patients-collection";
import { TODAY_ISO } from "@/lib/utils/seeded-random";
import type { Referral } from "@/lib/types/patient";

interface ConfirmArrivalDialogProps {
  referral: Referral | null;
  onOpenChange: (open: boolean) => void;
  onAdmitted: (patientId: string) => void;
}

export function ConfirmArrivalDialog({ referral, onOpenChange, onAdmitted }: ConfirmArrivalDialogProps) {
  const { stays, addPatient, addCarer, addStay } = usePatientsData();
  const [bedPositionId, setBedPositionId] = React.useState<string>("");
  const [submitting, setSubmitting] = React.useState(false);

  // A bed is only genuinely free if its unit isn't under maintenance/blocked AND no
  // active stay currently references that exact bed position — Unit.status alone
  // can't be trusted (it's independent seed data, not derived from real occupancy).
  const availablePositions = bedPositions.filter((pos) => {
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
    if (!referral || !bedPositionId) return;
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
    setBedPositionId("");
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
          <FieldLabel htmlFor="bed">Bed position</FieldLabel>
          <Select value={bedPositionId} onValueChange={setBedPositionId}>
            <SelectTrigger id="bed" className="w-full">
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
            {submitting ? "Admitting…" : "Confirm & Admit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
