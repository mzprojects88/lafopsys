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
};
const num = (s: string) => (s.trim() === "" ? null : Number(s));

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
  const start = vehicle ?? NEW;
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
  const badNumber = [tank, kmPerLitre].some((s) => s.trim() !== "" && !(Number(s) > 0));

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
    });
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
