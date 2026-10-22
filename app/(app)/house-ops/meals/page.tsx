"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Banknote, ChefHat, Users, Utensils } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { DataTable } from "@/components/patterns/data-table";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { Input } from "@/components/ui/input";
import { useKitchenRecords, type KitchenMeal } from "@/lib/hooks/use-kitchen-records";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate, todayIso } from "@/lib/utils/date";

const peso = (v: number | null) => (v === null ? "—" : formatCurrency(v, "PHP"));

const columns: ColumnDef<KitchenMeal>[] = [
  { accessorKey: "date", header: "Date", cell: ({ row }) => formatDate(row.original.date) },
  { accessorKey: "mealType", header: "Meal", cell: ({ row }) => <span className="capitalize">{row.original.mealType}</span> },
  { accessorKey: "dish", header: "Dish", cell: ({ row }) => row.original.dish ?? <span className="text-muted-foreground">—</span> },
  { accessorKey: "patients", header: "Patients" },
  { accessorKey: "carers", header: "Carers" },
  { accessorKey: "others", header: "Others" },
  { accessorKey: "served", header: "Served" },
  { id: "cost", header: "Stock used", cell: ({ row }) => peso(row.original.drawValue) },
  {
    id: "perHead",
    header: "Per person",
    cell: ({ row }) => (row.original.drawValue !== null && row.original.served > 0 ? peso(Math.round((row.original.drawValue / row.original.served) * 100) / 100) : "—"),
  },
];

/**
 * Meals (0102): what LAF Inventory's kitchen recorded -- each meal's headcount, dish and the stock
 * drawn for it -- read only. Meals are recorded in LAF Inventory › Meals.
 */
export default function MealsPage() {
  const [month, setMonth] = React.useState(todayIso().slice(0, 7));
  const from = `${month}-01`;
  const to = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const { rows, error } = useKitchenRecords("house_meals", from, to);
  const meals = rows ?? [];
  const served = meals.reduce((s, m) => s + m.served, 0);
  const linked = meals.filter((m) => m.drawValue !== null);
  const stock = linked.reduce((s, m) => s + (m.drawValue ?? 0), 0);
  const linkedServed = linked.reduce((s, m) => s + m.served, 0);

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Meals"
        description="Meals the kitchen recorded in LAF Inventory, with who was served and the stock used. Read only: meals are recorded in LAF Inventory › Meals."
        action={<Input type="month" aria-label="Month" className="w-44" value={month} max={todayIso().slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} />}
      />
      <KpiGrid>
        <KpiCard label="Meals recorded" value={meals.length.toLocaleString()} icon={Utensils} />
        <KpiCard label="People served" value={served.toLocaleString()} icon={Users} />
        <KpiCard label="Stock used" value={formatCurrency(stock, "PHP")} icon={Banknote} sublabel={linked.length < meals.length ? `${linked.length} of ${meals.length} meals linked to a draw` : undefined} />
        <KpiCard label="Stock per person" value={linkedServed ? formatCurrency(Math.round((stock / linkedServed) * 100) / 100, "PHP") : "—"} icon={ChefHat} />
      </KpiGrid>
      {error ? (
        <p className="text-theme-sm text-destructive">{error}</p>
      ) : rows === null ? (
        <p className="text-theme-sm text-muted-foreground">Loading meals…</p>
      ) : (
        <DataTable columns={columns} data={meals} searchPlaceholder="Search by meal or dish…" pageSize={21} />
      )}
    </div>
  );
}
