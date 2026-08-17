"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/patterns/page-header";
import { DataTable } from "@/components/patterns/data-table";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTripsData } from "@/lib/hooks/use-trips-collection";
import { usePatientsData } from "@/lib/hooks/use-patients-collection";
import { useStaffRoster } from "@/lib/hooks/use-staff-roster";
import type { Trip, TripDirection } from "@/lib/types/house-ops";
import { formatDate } from "@/lib/utils/date";
import { TODAY_ISO } from "@/lib/utils/seeded-random";

const columns: ColumnDef<Trip>[] = [
  { accessorKey: "date", header: "Date", cell: ({ row }) => formatDate(row.original.date) },
  { accessorKey: "direction", header: "Direction", cell: ({ row }) => row.original.direction.replace("_", " ") },
  { accessorKey: "vehicle", header: "Vehicle" },
  { accessorKey: "departureTime", header: "Departure" },
  {
    id: "passengers",
    header: "Passengers",
    cell: ({ row }) => row.original.passengerPatientIds.length,
  },
  { accessorKey: "fuelCost", header: "Fuel Cost", cell: ({ row }) => (row.original.fuelCost ? `₱${row.original.fuelCost}` : "—") },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <StatusBadge domain="trip" status={row.original.status} />,
  },
];

export default function TripsPage() {
  const { trips, addTrip } = useTripsData();
  const { patients, stays } = usePatientsData();
  const { staff } = useStaffRoster();
  const [open, setOpen] = React.useState(false);
  const [direction, setDirection] = React.useState<TripDirection>("to_hospital");
  const [vehicle, setVehicle] = React.useState("LAF Van 1");
  const [driverStaffId, setDriverStaffId] = React.useState("");
  const [passengerIds, setPassengerIds] = React.useState<string[]>([]);
  const [submitting, setSubmitting] = React.useState(false);

  // Real passengers, not a random pick -- currently in-house patients only,
  // so a trip can only claim someone who's actually here to be transported.
  const inHousePatients = stays
    .filter((s) => s.status === "in_house" || s.status === "overdue")
    .map((s) => patients.find((p) => p.id === s.patientId))
    .filter((p): p is NonNullable<typeof p> => !!p);

  function togglePassenger(patientId: string, checked: boolean) {
    setPassengerIds((prev) => (checked ? [...prev, patientId] : prev.filter((id) => id !== patientId)));
  }

  async function handleCreate() {
    setSubmitting(true);
    const result = await addTrip({
      date: TODAY_ISO,
      direction,
      driverId: driverStaffId,
      vehicle,
      departureTime: new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
      passengerPatientIds: passengerIds,
      odometerStart: 0,
      status: "scheduled",
    });
    setSubmitting(false);
    if (!result.ok) {
      toast.error(`Couldn't log the trip: ${result.error}`);
      return;
    }
    toast.success("Trip logged");
    setPassengerIds([]);
    setDriverStaffId("");
    setOpen(false);
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Trips"
        description="Passengers linked to stays, so transported figures are verifiable."
        action={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button><Plus />New Trip</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Log New Trip</DialogTitle>
                <DialogDescription>Select the driver, direction, and who&apos;s actually riding along.</DialogDescription>
              </DialogHeader>
              <FieldGroup>
                <Field>
                  <FieldLabel>Driver</FieldLabel>
                  <Select value={driverStaffId} onValueChange={setDriverStaffId}>
                    <SelectTrigger className="w-full"><SelectValue placeholder="Select a driver" /></SelectTrigger>
                    <SelectContent>
                      {staff.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.firstName} {s.lastName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel>Direction</FieldLabel>
                  <Select value={direction} onValueChange={(v) => setDirection(v as TripDirection)}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="to_hospital">To Hospital</SelectItem>
                      <SelectItem value="from_hospital">From Hospital</SelectItem>
                      <SelectItem value="errand">Errand</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel>Vehicle</FieldLabel>
                  <Select value={vehicle} onValueChange={setVehicle}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="LAF Van 1">LAF Van 1</SelectItem>
                      <SelectItem value="LAF Van 2">LAF Van 2</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel>Passengers (currently in-house)</FieldLabel>
                  {inHousePatients.length === 0 ? (
                    <p className="text-xs italic text-muted-foreground">No patients currently in-house.</p>
                  ) : (
                    <div className="flex max-h-40 flex-col gap-1.5 overflow-y-auto rounded-md border p-2">
                      {inHousePatients.map((p) => (
                        <label key={p.id} className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={passengerIds.includes(p.id)}
                            onCheckedChange={(v) => togglePassenger(p.id, !!v)}
                          />
                          {p.firstName} {p.lastName}
                        </label>
                      ))}
                    </div>
                  )}
                </Field>
              </FieldGroup>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button disabled={submitting} onClick={handleCreate}>
                  {submitting ? "Logging…" : "Log Trip"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />
      <DataTable columns={columns} data={trips} searchPlaceholder="Search trips…" />
    </div>
  );
}
