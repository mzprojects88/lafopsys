"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { PageHeader } from "@/components/patterns/page-header";
import { DataTable } from "@/components/patterns/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ReasonDialog } from "@/components/patterns/reason-dialog";
import { mealServices as seedMeals, patients } from "@/lib/mock-data";
import { useLocalCollection } from "@/lib/store/use-mock-store";
import type { MealService } from "@/lib/types/house-ops";
import { formatDate } from "@/lib/utils/date";

export default function MealsPage() {
  const { items, updateItem } = useLocalCollection<MealService>("meal-services", seedMeals);
  const [exceptionTarget, setExceptionTarget] = React.useState<string | null>(null);

  const columns: ColumnDef<MealService>[] = [
    { accessorKey: "date", header: "Date", cell: ({ row }) => formatDate(row.original.date) },
    { accessorKey: "mealType", header: "Meal", cell: ({ row }) => <span className="capitalize">{row.original.mealType}</span> },
    { accessorKey: "headcount", header: "Headcount" },
    { accessorKey: "costPerHead", header: "Cost / Head", cell: ({ row }) => `₱${row.original.costPerHead}` },
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
                  {p?.firstName} — {ex.reason}
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
            setExceptionTarget(row.original.id);
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
      <DataTable columns={columns} data={items} searchPlaceholder="Search by meal type…" pageSize={14} />

      <ReasonDialog
        open={!!exceptionTarget}
        onOpenChange={(open) => !open && setExceptionTarget(null)}
        title="Mark meal exception"
        description="e.g. hospital confinement, dietary restriction, out on trip."
        confirmLabel="Save Exception"
        onConfirm={(reason) => {
          const meal = items.find((m) => m.id === exceptionTarget);
          if (!meal) return;
          const patient = patients[Math.floor(Math.random() * patients.length)];
          updateItem(meal.id, {
            exceptions: [...meal.exceptions, { patientId: patient.id, reason }],
            headcount: Math.max(0, meal.headcount - 1),
          });
          toast.success("Exception recorded");
        }}
      />
    </div>
  );
}
