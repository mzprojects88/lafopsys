"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/patterns/page-header";
import { DataTable } from "@/components/patterns/data-table";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Button } from "@/components/ui/button";
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
import { trips as seedTrips, staff } from "@/lib/mock-data";
import { useLocalCollection } from "@/lib/store/use-mock-store";
import type { Trip, TripDirection } from "@/lib/types/house-ops";
import { formatDate } from "@/lib/utils/date";
import { TODAY_ISO } from "@/lib/utils/seeded-random";
import { newId } from "@/lib/utils/id";

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
  const { items, addItem } = useLocalCollection<Trip>("trips", seedTrips);
  const [open, setOpen] = React.useState(false);
  const [direction, setDirection] = React.useState<TripDirection>("to_hospital");
  const [vehicle, setVehicle] = React.useState("LAF Van 1");

  function handleCreate() {
    addItem({
      id: newId("trip-new"),
      date: TODAY_ISO,
      direction,
      driverId: "stf-7",
      vehicle,
      departureTime: new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
      passengerPatientIds: [],
      odometerStart: 41000,
      status: "scheduled",
    });
    toast.success("Trip logged");
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
                <DialogDescription>Driver: {staff.find((s) => s.id === "stf-7")?.firstName} Fajardo</DialogDescription>
              </DialogHeader>
              <FieldGroup>
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
              </FieldGroup>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button onClick={handleCreate}>Log Trip</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />
      <DataTable columns={columns} data={items} searchPlaceholder="Search trips…" />
    </div>
  );
}
