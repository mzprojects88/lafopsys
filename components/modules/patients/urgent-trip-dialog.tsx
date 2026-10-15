"use client";

import * as React from "react";
import { toast } from "sonner";
import { Ambulance } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePickups } from "@/lib/hooks/use-pickups-collection";
import { useStaffRoster } from "@/lib/hooks/use-staff-roster";
import { holdsPower } from "@/lib/rbac/roles";
import { DEFAULT_HOSPITAL } from "@/lib/utils/trip-direction";
import { plainError } from "@/lib/utils/plain-error";

const NO_DRIVER = "none";

/**
 * The doctor's urgent call (0097): HOPE in Transit takes the child and carer to the hospital now,
 * the child is admitted there, and the family is checked out of LAF -- tonight's bed is freed.
 */
export function UrgentTripDialog({ stayId, name, onClose }: { stayId: string; name: string; onClose: () => void }) {
  const { urgentHospitalTrip } = usePickups();
  const { staff } = useStaffRoster();
  const [hospital, setHospital] = React.useState(DEFAULT_HOSPITAL);
  const [driverId, setDriverId] = React.useState(NO_DRIVER);
  const [note, setNote] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const drivers = staff.filter((s) => s.active && holdsPower([s.role, ...s.extraRoles], "driver"));

  async function send() {
    setSaving(true);
    const r = await urgentHospitalTrip({ stayId, destination: hospital.trim(), driverId: driverId === NO_DRIVER ? null : driverId, note: note.trim() || null });
    setSaving(false);
    if (!r.ok) {
      toast.error(plainError(r.error));
      return;
    }
    toast.success(`${name} is on the urgent trip and checked out of LAF`);
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Ambulance className="size-5 text-destructive" /> Urgent call: {name}
          </DialogTitle>
          <DialogDescription>
            HOPE in Transit takes the child and carer to the hospital now. The child is admitted there, so the family is checked out of LAF and
            tonight&apos;s bed is freed.
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="urgentHospital">Hospital</FieldLabel>
          <Input id="urgentHospital" value={hospital} maxLength={160} onChange={(e) => setHospital(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="urgentDriver">Driver</FieldLabel>
          <Select value={driverId} onValueChange={setDriverId}>
            <SelectTrigger id="urgentDriver" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_DRIVER}>Whoever is driving</SelectItem>
              {drivers.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.firstName} {d.lastName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="urgentNote">Note for the driver (optional)</FieldLabel>
          <Input id="urgentNote" value={note} maxLength={200} placeholder="Urgent call by the doctor" onChange={(e) => setNote(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={!hospital.trim() || saving} onClick={send}>
            {saving ? "Sending…" : "Send to the hospital now"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
