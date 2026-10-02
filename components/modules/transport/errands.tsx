"use client";

import * as React from "react";
import { toast } from "sonner";
import { Car } from "lucide-react";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRole } from "@/context/role-provider";
import { useStaffRoster } from "@/lib/hooks/use-staff-roster";
import { startErrand, useErrands, type Errand, type Vehicle } from "@/lib/hooks/use-vehicles-collection";
import { formatDate } from "@/lib/utils/date";
import { readingProblem } from "@/lib/utils/odometer";
import type { TripDirection } from "@/lib/types/house-ops";
import { OdometerDrums } from "./odometer-drums";
import { TripControls, TripReadings } from "./trip-controls";

export const PURPOSE_LABEL: Record<Exclude<TripDirection, "from_hospital">, string> = {
  errand: "Errand",
  to_hospital: "Hospital run",
  other: "Other trip",
};
const STATUS_LABEL = { scheduled: "Not left yet", in_progress: "On the road", completed: "Done" } as const;
const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" }) : "");

export function errandTitle(e: Errand): string {
  const purpose = PURPOSE_LABEL[e.direction as keyof typeof PURPOSE_LABEL] ?? "Trip";
  return e.destination ? `${purpose} · ${e.destination}` : purpose;
}

export function ErrandCard({ errand: e, vehicle, mine, driverName, canEdit }: { errand: Errand; vehicle: Vehicle | undefined; mine: boolean; driverName: string; canEdit: boolean }) {
  return (
    <Card className={mine ? "border-primary/50" : undefined}>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <div className="flex min-w-0 flex-col">
          <CardTitle className="flex items-center gap-2 text-base">
            <Car className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{errandTitle(e)}</span>
            {mine && <Badge>Your trip</Badge>}
          </CardTitle>
          <span className="text-theme-xs text-muted-foreground">
            {formatDate(e.date, "EEE, MMM d")} · {vehicle?.name ?? "Vehicle"} · {driverName}
            {e.departedAt ? ` · left ${time(e.departedAt)}` : ""}
            {e.arrivedAt ? ` · done ${time(e.arrivedAt)}` : ""}
          </span>
        </div>
        <StatusBadge domain="trip" status={e.status} label={STATUS_LABEL[e.status]} />
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <TripReadings trip={e} />
        <TripControls trip={e} vehicle={vehicle} canEdit={canEdit} departLabel="Depart" arriveLabel="Trip done" />
      </CardContent>
    </Card>
  );
}

/** An errand or hospital run leaving now, with the odometer when the vehicle is tracked. */
export function StartTripDialog({ vehicles, onClose }: { vehicles: Vehicle[]; onClose: () => void }) {
  const { roles, staffId } = useRole();
  const { staff } = useStaffRoster();
  const { errands } = useErrands();
  const iDrive = roles.includes("driver");
  const drivers = staff.filter((s) => s.active && (s.role === "driver" || s.extraRoles.includes("driver")));
  const [vehicleId, setVehicleId] = React.useState(vehicles[0]?.id ?? "");
  const [purpose, setPurpose] = React.useState<keyof typeof PURPOSE_LABEL>("errand");
  const [destination, setDestination] = React.useState("");
  const [driverId, setDriverId] = React.useState(iDrive ? (staffId ?? "") : "");
  const vehicle = vehicles.find((v) => v.id === vehicleId);
  const tracked = vehicle?.startOdometer != null;
  const [km, setKm] = React.useState<number | null>(vehicle?.lastReading ?? null);
  const [saving, setSaving] = React.useState(false);
  const places = [...new Set(errands.map((e) => e.destination).filter((d): d is string => !!d))].sort();
  const odometerProblem = tracked ? readingProblem(km, vehicle?.lastReading ?? null) : null;

  async function save() {
    if (!vehicle || !destination.trim() || odometerProblem) return;
    setSaving(true);
    const r = await startErrand({ vehicleId: vehicle.id, direction: purpose, destination, driverId: driverId || null, odometerStart: tracked ? km : null });
    setSaving(false);
    if (!r.ok) {
      toast.error(`Couldn't start the trip: ${r.error}`);
      return;
    }
    toast.success("On the road");
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Start a trip</DialogTitle>
          <DialogDescription>An errand or hospital run leaving now. NCH pick-ups use New pick-up.</DialogDescription>
        </DialogHeader>
        {vehicles.length > 1 && (
          <Field>
            <FieldLabel htmlFor="tripVehicle">Vehicle</FieldLabel>
            <Select value={vehicleId} onValueChange={(id) => { setVehicleId(id); setKm(vehicles.find((v) => v.id === id)?.lastReading ?? null); }}>
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
        <div className="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel htmlFor="tripPurpose">Purpose</FieldLabel>
            <Select value={purpose} onValueChange={(v) => setPurpose(v as keyof typeof PURPOSE_LABEL)}>
              <SelectTrigger id="tripPurpose" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PURPOSE_LABEL).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="tripDriver">Driver</FieldLabel>
            <Select value={driverId} onValueChange={setDriverId}>
              <SelectTrigger id="tripDriver" className="w-full">
                <SelectValue placeholder="Select…" />
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
          <FieldLabel htmlFor="tripDestination">Where to</FieldLabel>
          <Input id="tripDestination" list="tripPlaces" value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="e.g. PGH, Puregold Cubao, LTO" />
          <datalist id="tripPlaces">
            {places.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </Field>
        {tracked && (
          <Field className="items-center">
            <FieldLabel>Odometer now</FieldLabel>
            <OdometerDrums value={km} onChange={setKm} />
            <FieldDescription className="text-center">{odometerProblem ?? "Check the dashboard. Tap the drums to change them."}</FieldDescription>
          </Field>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!vehicle || !destination.trim() || !!odometerProblem || saving} onClick={save}>
            {saving ? "Saving…" : "Depart now"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
