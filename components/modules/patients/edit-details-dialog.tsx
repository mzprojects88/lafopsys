"use client";

import * as React from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePatientsData } from "@/lib/hooks/use-patients-collection";
import { todayIso } from "@/lib/utils/date";
import type { Carer, Patient } from "@/lib/types/patient";

interface EditDetailsDialogProps {
  patient: Patient;
  /** The carer being edited; none means the child has no carer on file yet and one is added. */
  carer: Carer | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * The social worker completes what the Patients Database sheet does not
 * carry (user, 2026-09-23). The sheet still wins on any cell it fills; a
 * blank cell never erases what is saved here.
 */
export function EditDetailsDialog({ patient, carer, open, onOpenChange }: EditDetailsDialogProps) {
  const { updatePatient, updateCarer, addCarer } = usePatientsData();
  const [birthDate, setBirthDate] = React.useState(patient.birthDate ?? "");
  const [sex, setSex] = React.useState<Patient["sex"]>(patient.sex);
  const [address, setAddress] = React.useState(patient.rawAddress ?? "");
  const [carerName, setCarerName] = React.useState(carer?.name ?? "");
  const [relationship, setRelationship] = React.useState(carer?.relationship ?? "");
  const [phone, setPhone] = React.useState(carer?.mobileNumber ?? "");
  const [saving, setSaving] = React.useState(false);

  async function save() {
    if (!carerName.trim() && (relationship.trim() || phone.trim())) {
      toast.error("Give the carer's name too.");
      return;
    }
    setSaving(true);
    const p = await updatePatient(patient.id, { birthDate: birthDate || undefined, sex, rawAddress: address.trim() || undefined });
    const c = !carerName.trim()
      ? ({ ok: true } as const)
      : carer
        ? await updateCarer(carer.id, { name: carerName.trim(), relationship: relationship.trim(), mobileNumber: phone.trim() })
        : await addCarer({
            id: crypto.randomUUID(),
            patientId: patient.id,
            name: carerName.trim(),
            relationship: relationship.trim() || undefined,
            mobileNumber: phone.trim() || undefined,
            effectiveFrom: todayIso(),
          });
    setSaving(false);
    const failed = [p, c].find((r) => !r.ok);
    if (failed && !failed.ok) {
      toast.error(`Couldn't save: ${failed.error}`);
      return;
    }
    toast.success("Details saved.");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Edit details · {patient.firstName} {patient.lastName}
          </DialogTitle>
          <DialogDescription>
            Fill in what the Patients Database sheet does not have. Where the sheet has a value, the sheet&apos;s value is kept.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="ed-birth">Birthday</FieldLabel>
            <Input id="ed-birth" type="date" max={todayIso()} value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="ed-sex">Sex</FieldLabel>
            <Select value={sex ?? ""} onValueChange={(v) => setSex(v as "M" | "F")}>
              <SelectTrigger id="ed-sex" className="w-full">
                <SelectValue placeholder="Not recorded" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="M">Male</SelectItem>
                <SelectItem value="F">Female</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="ed-address">Address</FieldLabel>
            <Input id="ed-address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="House no., street, barangay, city" />
          </Field>
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="ed-carer">Carer</FieldLabel>
            <Input id="ed-carer" value={carerName} onChange={(e) => setCarerName(e.target.value)} placeholder="Last name, First name" />
          </Field>
          <Field>
            <FieldLabel htmlFor="ed-rel">Relationship</FieldLabel>
            <Input id="ed-rel" value={relationship} onChange={(e) => setRelationship(e.target.value)} placeholder="Mother" />
          </Field>
          <Field>
            <FieldLabel htmlFor="ed-phone">Carer&apos;s phone</FieldLabel>
            <Input id="ed-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="09XX XXX XXXX" />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save details"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
