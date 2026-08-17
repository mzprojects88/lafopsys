"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { PageHeader } from "@/components/patterns/page-header";
import { DataTable } from "@/components/patterns/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMealServicesData } from "@/lib/hooks/use-meal-services-collection";
import { usePatientsData } from "@/lib/hooks/use-patients-collection";
import type { MealService } from "@/lib/types/house-ops";
import { formatDate } from "@/lib/utils/date";

export default function MealsPage() {
  const { meals, addException } = useMealServicesData();
  const { patients, stays } = usePatientsData();
  const [exceptionTarget, setExceptionTarget] = React.useState<MealService | null>(null);
  const [patientId, setPatientId] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  // Staff picks who the exception is actually for -- restricted to currently
  // in-house patients, replacing the old demo handler's random pick.
  const inHousePatients = stays
    .filter((s) => s.status === "in_house" || s.status === "overdue")
    .map((s) => patients.find((p) => p.id === s.patientId))
    .filter((p): p is NonNullable<typeof p> => !!p);

  function closeDialog() {
    setExceptionTarget(null);
    setPatientId("");
    setReason("");
  }

  async function handleConfirm() {
    if (!exceptionTarget || !patientId || !reason.trim()) return;
    setSubmitting(true);
    const result = await addException(exceptionTarget.id, patientId, reason.trim(), exceptionTarget.headcount);
    setSubmitting(false);
    if (!result.ok) {
      toast.error(`Couldn't record the exception: ${result.error}`);
      return;
    }
    toast.success("Exception recorded");
    closeDialog();
  }

  const columns: ColumnDef<MealService>[] = [
    { accessorKey: "date", header: "Date", cell: ({ row }) => formatDate(row.original.date) },
    { accessorKey: "mealType", header: "Meal", cell: ({ row }) => <span className="capitalize">{row.original.mealType}</span> },
    { accessorKey: "headcount", header: "Headcount" },
    {
      accessorKey: "costPerHead",
      header: "Cost / Head",
      cell: ({ row }) => (row.original.costPerHead !== undefined ? `₱${row.original.costPerHead}` : "—"),
    },
    {
      id: "exceptions",
      header: "Exceptions",
      cell: ({ row }) =>
        row.original.exceptions.length === 0 ? (
          <span className="text-xs text-muted-foreground">None</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {row.original.exceptions.map((ex, i) => {
              const p = patients.find((pt) => pt.id === ex.patientId);
              return (
                <Badge key={i} variant="secondary" className="text-[10px]">
                  {p?.firstName ?? "Unknown"} — {ex.reason}
                </Badge>
              );
            })}
          </div>
        ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={(e) => {
            e.stopPropagation();
            setExceptionTarget(row.original);
          }}
        >
          Mark Exception
        </Button>
      ),
    },
  ];

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Meals"
        description="Auto-generated from who is in-house. Staff mark exceptions only, not every meal."
      />
      <DataTable columns={columns} data={meals} searchPlaceholder="Search by meal type…" pageSize={14} />

      <Dialog open={!!exceptionTarget} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Mark meal exception</DialogTitle>
            <DialogDescription>e.g. hospital confinement, dietary restriction, out on trip.</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="exceptionPatient">Patient</FieldLabel>
            <Select value={patientId} onValueChange={setPatientId}>
              <SelectTrigger id="exceptionPatient" className="w-full">
                <SelectValue placeholder={inHousePatients.length ? "Select a patient" : "No patients currently in-house"} />
              </SelectTrigger>
              <SelectContent>
                {inHousePatients.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.firstName} {p.lastName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="exceptionReason">Reason</FieldLabel>
            <Textarea id="exceptionReason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              Cancel
            </Button>
            <Button disabled={!patientId || !reason.trim() || submitting} onClick={handleConfirm}>
              {submitting ? "Saving…" : "Save Exception"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
