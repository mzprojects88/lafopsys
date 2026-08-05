"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { PageHeader } from "@/components/patterns/page-header";
import { DataTable } from "@/components/patterns/data-table";
import { Progress } from "@/components/ui/progress";
import { budgetLines, programs } from "@/lib/mock-data";
import type { BudgetLine } from "@/lib/types/finance";
import { formatCurrency } from "@/lib/utils/currency";

const columns: ColumnDef<BudgetLine>[] = [
  {
    id: "program",
    header: "Program",
    cell: ({ row }) => programs.find((p) => p.id === row.original.programId)?.name ?? "—",
  },
  { accessorKey: "month", header: "Month" },
  { accessorKey: "budgeted", header: "Budgeted", cell: ({ row }) => formatCurrency(row.original.budgeted) },
  { accessorKey: "actual", header: "Actual", cell: ({ row }) => formatCurrency(row.original.actual) },
  {
    id: "pct",
    header: "% Used",
    cell: ({ row }) => {
      const pct = Math.round((row.original.actual / row.original.budgeted) * 100);
      return (
        <div className="flex w-32 items-center gap-2">
          <Progress value={Math.min(100, pct)} className="h-1.5" />
          <span className="w-10 text-xs tabular-nums">{pct}%</span>
        </div>
      );
    },
  },
];

export default function BudgetPage() {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="Budget vs Actual" description="By program, by month." />
      <DataTable columns={columns} data={budgetLines} searchPlaceholder="Search program or month…" pageSize={12} />
    </div>
  );
}
