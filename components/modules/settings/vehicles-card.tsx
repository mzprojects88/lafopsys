"use client";

import * as React from "react";
import { toast } from "sonner";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { OdometerDrums } from "@/components/modules/transport/odometer-drums";
import { useVehicles, type Vehicle } from "@/lib/hooks/use-vehicles-collection";
import { fleetStore, saveServiceRules } from "@/lib/hooks/use-fleet-collection";
import { expenseKindsStore } from "@/lib/hooks/use-vehicle-expenses-collection";
import { useCollection } from "@/lib/data/collection-store";
import { formatKm } from "@/lib/utils/odometer";

const NEW: Omit<Vehicle, "id" | "lastReading" | "photoToday"> = {
  name: "",
  plateNo: null,
  fuelType: "diesel",
  tankLitres: null,
  fuelDoorSide: null,
  defaultKmPerLitre: null,
  startOdometer: null,
  active: true,
  efficiencyAlertPct: 20,
};
const num = (s: string) => (s.trim() === "" ? null : Number(s));
// The expense types that come round on a schedule (0079); the others are one-offs.
const SERVICE_KINDS = ["change_oil", "tires", "maintenance", "registration", "insurance"];

/** Settings: LAF's vehicles (0076). The starting odometer is what turns tracking on. */
export function VehiclesCard() {
  const { vehicles, loading } = useVehicles();
  const [editing, setEditing] = React.useState<Vehicle | "new" | null>(null);

  return (
    <div className="flex flex-col gap-3">
      {!loading && vehicles.length === 0 && <p className="text-theme-xs text-muted-foreground">No vehicles yet.</p>}
      {vehicles.map((v) => (
        <div key={v.id} className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-theme-sm font-medium text-foreground">
              {v.name}
              {!v.active ? " (retired)" : ""}
            </span>
            <span className="text-theme-xs text-muted-foreground">
              {v.startOdometer == null ? "Odometer not tracked yet" : `Tracking · ${formatKm(v.lastReading ?? v.startOdometer)}`}
            </span>
          </div>
          <Button size="icon-sm" variant="ghost" aria-label={`Edit ${v.name}`} onClick={() => setEditing(v)}>
            <Pencil />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" className="self-start" onClick={() => setEditing("new")}>
        <Plus /> Add a vehicle
      </Button>
      {editing && <VehicleDialog vehicle={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function VehicleDialog({ vehicle, onClose }: { vehicle: Vehicle | null; onClose: () => void }) {
  const { saveVehicle } = useVehicles();
  const { data: fleet } = useCollection(fleetStore);
  const { data: kinds } = useCollection(expenseKindsStore);
  const start = vehicle ?? NEW;
  const serviceKinds = kinds.filter((k) => SERVICE_KINDS.includes(k.id));
  const [intervals, setIntervals] = React.useState<Record<string, { km: string; months: string }>>(() =>
    Object.fromEntries(
      SERVICE_KINDS.map((k) => {
        const rule = fleet.rules.find((r) => r.vehicleId === vehicle?.id && r.kind === k);
        return [k, { km: rule?.everyKm?.toString() ?? "", months: rule?.everyMonths?.toString() ?? "" }];
      })
    )
  );
  const [alertPct, setAlertPct] = React.useState(start.efficiencyAlertPct.toString());
  const [name, setName] = React.useState(start.name);
  const [plate, setPlate] = React.useState(start.plateNo ?? "");
  const [fuelType, setFuelType] = React.useState(start.fuelType);
  const [tank, setTank] = React.useState(start.tankLitres?.toString() ?? "");
  const [door, setDoor] = React.useState<string>(start.fuelDoorSide ?? "");
  const [kmPerLitre, setKmPerLitre] = React.useState(start.defaultKmPerLitre?.toString() ?? "");
  const [odometer, setOdometer] = React.useState<number | null>(start.startOdometer);
  const [active, setActive] = React.useState(start.active);
  const [saving, setSaving] = React.useState(false);
  // Trips already read past the start: the database keeps the starting reading from moving (0076).
  const hasReadings = vehicle != null && vehicle.startOdometer != null && vehicle.lastReading != null && vehicle.lastReading !== vehicle.startOdometer;
  const badNumber =
    [tank, kmPerLitre].some((s) => s.trim() !== "" && !(Number(s) > 0)) ||
    !(Number(alertPct) >= 5 && Number(alertPct) <= 90) ||
    Object.values(intervals).some(
      (i) => (i.km.trim() !== "" && !(Number.isInteger(Number(i.km)) && Number(i.km) > 0)) || (i.months.trim() !== "" && !(Number.isInteger(Number(i.months)) && Number(i.months) >= 1 && Number(i.months) <= 60))
    );

  async function save() {
    setSaving(true);
    const r = await saveVehicle({
      id: vehicle?.id,
      name,
      plateNo: plate,
      fuelType,
      tankLitres: num(tank),
      fuelDoorSide: door === "left" || door === "right" ? door : null,
      defaultKmPerLitre: num(kmPerLitre),
      startOdometer: odometer,
      active,
      efficiencyAlertPct: Number(alertPct),
    });
    if (r.ok && vehicle) {
      const rules = await saveServiceRules(
        vehicle.id,
        serviceKinds.map((k) => ({ kind: k.id, everyKm: num(intervals[k.id].km), everyMonths: num(intervals[k.id].months) }))
      );
      if (!rules.ok) {
        setSaving(false);
        toast.error(`Saved, but the service intervals weren't: ${rules.error}`);
        return;
      }
    }
    setSaving(false);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    toast.success(vehicle ? `${name.trim()} saved` : `${name.trim()} added`);
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{vehicle ? vehicle.name : "Add a vehicle"}</DialogTitle>
          <DialogDescription>Fuel Monitoring uses these figures. Only the Super Admin changes them.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel htmlFor="vehName">Name</FieldLabel>
            <Input id="vehName" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="vehPlate">Plate number</FieldLabel>
            <Input id="vehPlate" value={plate} onChange={(e) => setPlate(e.target.value)} placeholder="e.g. NBC 1234" />
          </Field>
          <Field>
            <FieldLabel htmlFor="vehFuel">Fuel</FieldLabel>
            <Select value={fuelType} onValueChange={(v) => setFuelType(v as Vehicle["fuelType"])}>
              <SelectTrigger id="vehFuel" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="diesel">Diesel</SelectItem>
                <SelectItem value="gasoline">Gasoline</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="vehDoor">Fuel cap side</FieldLabel>
            <Select value={door} onValueChange={setDoor}>
              <SelectTrigger id="vehDoor" className="w-full">
                <SelectValue placeholder="Select…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="left">Left</SelectItem>
                <SelectItem value="right">Right</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="vehTank">Tank (litres)</FieldLabel>
            <Input id="vehTank" type="number" inputMode="decimal" min="1" value={tank} onChange={(e) => setTank(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="vehKmL">Km per litre</FieldLabel>
            <Input id="vehKmL" type="number" inputMode="decimal" min="0.1" step="0.1" value={kmPerLitre} onChange={(e) => setKmPerLitre(e.target.value)} />
          </Field>
        </div>
        <FieldDescription>Km per litre is a starting figure; Fuel Monitoring measures the real one from full-tank fills.</FieldDescription>
        <Field>
          <FieldLabel htmlFor="vehAlert">Flag km per litre falling by (%)</FieldLabel>
          <Input id="vehAlert" type="number" inputMode="numeric" min="5" max="90" value={alertPct} onChange={(e) => setAlertPct(e.target.value)} className="w-28" />
          <FieldDescription>Against the average of the full tanks before. 20% to start.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel>Service intervals</FieldLabel>
          {vehicle ? (
            <div className="flex flex-col gap-2">
              {serviceKinds.map((k) => (
                <div key={k.id} className="grid grid-cols-[1fr_5.5rem_5.5rem] items-center gap-2">
                  <span className="text-theme-sm">{k.name}</span>
                  <Input
                    aria-label={`${k.name}: every so many km`}
                    type="number"
                    inputMode="numeric"
                    min="1"
                    placeholder="km"
                    value={intervals[k.id].km}
                    onChange={(e) => setIntervals((p) => ({ ...p, [k.id]: { ...p[k.id], km: e.target.value } }))}
                  />
                  <Input
                    aria-label={`${k.name}: every so many months`}
                    type="number"
                    inputMode="numeric"
                    min="1"
                    max="60"
                    placeholder="months"
                    value={intervals[k.id].months}
                    onChange={(e) => setIntervals((p) => ({ ...p, [k.id]: { ...p[k.id], months: e.target.value } }))}
                  />
                </div>
              ))}
              <FieldDescription>Every so many km or months, whichever comes first. Leave both empty for no reminder.</FieldDescription>
            </div>
          ) : (
            <FieldDescription>Save the vehicle first, then set when its oil, tires and services are due.</FieldDescription>
          )}
        </Field>
        <Field className="items-center">
          <FieldLabel>Starting odometer</FieldLabel>
          {hasReadings ? (
            <OdometerDrums value={odometer} />
          ) : (
            <OdometerDrums value={odometer} onChange={setOdometer} label="Starting odometer" />
          )}
          <FieldDescription className="text-center">
            {hasReadings
              ? "Trips already have readings; correct a trip instead."
              : odometer == null
                ? "Tracking starts when this is set: from then on, every departure and arrival takes the reading."
                : "Drivers enter the reading on every departure and arrival."}
          </FieldDescription>
        </Field>
        {vehicle && (
          <label className="flex items-center justify-between gap-2 text-theme-sm">
            In use
            <Switch checked={active} onCheckedChange={setActive} />
          </label>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!name.trim() || badNumber || saving} onClick={save}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
