"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { PeriodPresetsBar, usePeriodPresets } from "@/components/patterns/period-presets";
import { PageHeader } from "@/components/patterns/page-header";
import { DataTable } from "@/components/patterns/data-table";
import { EmptyState } from "@/components/patterns/empty-state";
import { LoadingState } from "@/components/patterns/loading-state";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { Trash2, Wallet } from "lucide-react";
import { useStockSummary, useWasteLog } from "@/lib/hooks/use-inventory-views";
import type { WasteRow } from "@/lib/types/inventory-views";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate } from "@/lib/utils/date";

export default function WastePage() {
  return (
    <React.Suspense fallback={<LoadingState />}>
      <WasteContent />
    </React.Suspense>
  );
}

function WasteContent() {
  const { rows: all, loading, error } = useWasteLog();
  // Waste dated in the period (this month by default, or All time).
  const period = usePeriodPresets("waste", "this_month", true);
  const w = period.window;
  const rows = w ? all.filter((r) => r.date.slice(0, 10) >= w.from && r.date.slice(0, 10) <= w.to) : all;
  const { rows: stock } = useStockSummary();
  const uomByItem = new Map(stock.map((s) => [s.item_id, s.uom]));

  const columns: ColumnDef<WasteRow>[] = [
    { accessorKey: "date", header: "Date", cell: ({ row }) => formatDate(row.original.date) },
    { accessorKey: "name", header: "Item" },
    { id: "quantity", header: "Quantity", cell: ({ row }) => `${row.original.qty} ${uomByItem.get(row.original.item_id) ?? ""}` },
    { id: "value", header: "Value", cell: ({ row }) => formatCurrency(row.original.value) },
    { accessorKey: "reason", header: "Reason", cell: ({ row }) => row.original.reason ?? "—" },
    { accessorKey: "performed_by", header: "Logged By" },
  ];

  const totalValue = rows.reduce((s, r) => s + r.value, 0);

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="Waste Log" description="Every waste transaction recorded in the LAF Inventory app, with reason and value, for donor reporting." />

      <PeriodPresetsBar state={period.state} onChange={period.setState} today={period.today} allowAll />
      <KpiGrid>
        <KpiCard label="Waste Entries" value={loading ? "…" : rows.length} sublabel={period.label} icon={Trash2} />
        <KpiCard label="Value Wasted" value={loading ? "…" : formatCurrency(totalValue)} sublabel={period.label} icon={Wallet} />
      </KpiGrid>

      {error ? (
        <EmptyState title="Couldn't load the waste log" description={error} />
      ) : loading ? (
        <LoadingState />
      ) : (
        <DataTable columns={columns} data={rows} searchPlaceholder="Search waste log…" emptyMessage="No waste logged in this period." />
      )}
    </div>
  );
}
