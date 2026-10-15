"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePickups } from "@/lib/hooks/use-pickups-collection";
import { useHouseSheetPeople } from "@/lib/hooks/use-house-sheet-collection";
import { usePatientsData } from "@/lib/hooks/use-patients-collection";
import { useStaffRoster } from "@/lib/hooks/use-staff-roster";
import type { Vehicle } from "@/lib/hooks/use-vehicles-collection";
import { isActiveStay } from "@/lib/utils/beds";
import { todayIso } from "@/lib/utils/date";
import { holdsPower } from "@/lib/rbac/roles";
import { DEFAULT_HOSPITAL, tripWords } from "@/lib/utils/trip-direction";
import { plainError } from "@/lib/utils/plain-error";
import { houseSheetPatientId, type HouseSheetPerson } from "@/lib/types/house-sheet";

/** Names on NCH's sheet that day who are not in the house yet and not on another open pick-up. */
export function useManifestCandidates(date: string): HouseSheetPerson[] {
  const { people } = useHouseSheetPeople();
  const { stays } = usePatientsData();
  const { pickups } = usePickups();
  const inHouse = new Set(stays.filter(isActiveStay).map((s) => s.patientId));
  const taken = new Set(pickups.filter((p) => p.date === date && p.status !== "completed").flatMap((p) => p.manifest.map((m) => m.sheetRowId)));
  return people.filter((p) => {
    if (p.offSheetAt !== null || p.matchStatus === "dismissed" || taken.has(p.id)) return false;
    const pid = houseSheetPatientId(p);
    return !(pid && inHouse.has(pid));
  });
}

/** Children in the house now, by name: who can ride to the hospital. */
export function usePatientsInHouse(): { id: string; name: string }[] {
  const { patients, stays } = usePatientsData();
  const inHouse = new Set(stays.filter(isActiveStay).map((s) => s.patientId));
  return patients
    .filter((p) => inHouse.has(p.id))
    .map((p) => ({ id: p.id, name: `${p.lastName}, ${p.firstName}` }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** A pick-up from NCH's list or a delivery of children in the house to the hospital (0096). */
/** Where a trip starts from: Patients > Manifest opens a delivery with its children ticked (0097). */
export interface TripStart {
  direction: "from_hospital" | "to_hospital";
  date: string;
  departure: string;
  patientIds: string[];
}

export function NewTripDialog({ vehicles, start, onClose }: { vehicles: Vehicle[]; start?: TripStart; onClose: () => void }) {
  const { createTrip } = usePickups();
  const { staff } = useStaffRoster();
  const { patients } = usePatientsData();
  const [direction, setDirection] = React.useState<"from_hospital" | "to_hospital">(start?.direction ?? "from_hospital");
  const [date, setDate] = React.useState(start?.date ?? todayIso());
  const [departure, setDeparture] = React.useState(start?.departure ?? "18:00"); // LAF staff pick up at 6 PM (Important Notes)
  const [destination, setDestination] = React.useState(DEFAULT_HOSPITAL);
  const [vehicleId, setVehicleId] = React.useState(vehicles[0]?.id ?? "");
  const [driverId, setDriverId] = React.useState("");
  const [picked, setPicked] = React.useState<Set<string>>(() => new Set(start?.patientIds ?? []));
  const [saving, setSaving] = React.useState(false);
  const candidates = useManifestCandidates(date);
  const inHouse = usePatientsInHouse();
  const pickup = direction === "from_hospital";
  // A delivery: children in the house, plus any child the manifest chose who is not in tonight.
  const startedWith = (start?.patientIds ?? []).filter((id) => !inHouse.some((c) => c.id === id)).flatMap((id) => {
    const p = patients.find((x) => x.id === id);
    return p ? [{ id, name: `${p.lastName}, ${p.firstName}` }] : [];
  });
  const choices = pickup
    ? candidates.map((c) => ({ id: c.id, name: c.patientName, carer: c.carerName }))
    : [...inHouse, ...startedWith].map((c) => ({ ...c, carer: null as string | null }));
  // Main role or an additional one (0073): an inventory staff member may also drive.
  const drivers = staff.filter((s) => s.active && holdsPower([s.role, ...s.extraRoles], "driver"));

  function toggle(id: string, on: boolean) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    const r = await createTrip({
      date,
      departureTime: departure,
      driverId: driverId || null,
      direction,
      destination: pickup ? null : destination.trim() || null,
      vehicleId: vehicleId || null,
      sheetRowIds: pickup ? [...picked] : [],
      patientIds: pickup ? [] : [...picked],
    });
    setSaving(false);
    if (!r.ok) {
      toast.error(`Couldn't create the trip: ${plainError(r.error)}`);
      return;
    }
    toast.success(`${tripWords(direction).short} ready for the driver`);
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New trip</DialogTitle>
          <DialogDescription>The driver sees the passengers on their phone and can add one on the way.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Direction">
          {(["from_hospital", "to_hospital"] as const).map((d) => (
            <Button
              key={d}
              type="button"
              role="radio"
              aria-checked={direction === d}
              variant={direction === d ? "default" : "outline"}
              onClick={() => {
                setDirection(d);
                setPicked(new Set());
                setDeparture(d === "from_hospital" ? "18:00" : "07:00");
              }}
            >
              {tripWords(d).long}
            </Button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel htmlFor="tripDate">Day</FieldLabel>
            <Input id="tripDate" type="date" min={todayIso()} value={date} onChange={(e) => { setDate(e.target.value); setPicked(new Set()); }} />
          </Field>
          <Field>
            <FieldLabel htmlFor="tripTime">Leaves LAF House</FieldLabel>
            <Input id="tripTime" type="time" value={departure} onChange={(e) => setDeparture(e.target.value)} />
          </Field>
        </div>
        {!pickup && (
          <Field>
            <FieldLabel htmlFor="tripDestination">Hospital</FieldLabel>
            <Input id="tripDestination" value={destination} maxLength={160} onChange={(e) => setDestination(e.target.value)} />
          </Field>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {vehicles.length > 1 && (
            <Field>
              <FieldLabel htmlFor="tripVehicle">Vehicle</FieldLabel>
              <Select value={vehicleId} onValueChange={setVehicleId}>
                <SelectTrigger id="tripVehicle" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {vehicles.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          <Field>
            <FieldLabel htmlFor="tripDriver">Driver</FieldLabel>
            <Select value={driverId} onValueChange={setDriverId}>
              <SelectTrigger id="tripDriver" className="w-full">
                <SelectValue placeholder={drivers.length ? "Select the driver" : "No driver accounts"} />
              </SelectTrigger>
              <SelectContent>
                {drivers.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.firstName} {d.lastName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <Field>
          <FieldLabel>{pickup ? "From NCH's list" : "Children in the house"}</FieldLabel>
          {choices.length === 0 ? (
            <FieldDescription>{pickup ? "Nobody on NCH's sheet is waiting for a ride." : "Nobody is checked in."}</FieldDescription>
          ) : (
            <div className="flex flex-col gap-1.5">
              {choices.map((c) => (
                <label key={c.id} className="flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 py-2 text-theme-sm">
                  <Checkbox checked={picked.has(c.id)} onCheckedChange={(v) => toggle(c.id, !!v)} />
                  <span className="flex flex-col">
                    <span className="font-medium">{c.name}</span>
                    {c.carer && <span className="text-theme-xs text-muted-foreground">with {c.carer}</span>}
                  </span>
                </label>
              ))}
            </div>
          )}
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={picked.size === 0 || !departure || (!pickup && !destination.trim()) || saving} onClick={save}>
            {saving ? "Saving…" : `Create with ${picked.size}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
