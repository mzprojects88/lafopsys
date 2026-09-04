"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { PageHeader } from "@/components/patterns/page-header";
import { DataTable } from "@/components/patterns/data-table";
import { EmptyState } from "@/components/patterns/empty-state";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { Trash2, Wallet } from "lucide-react";
import { useStockSummary, useWasteLog } from "@/lib/hooks/use-inventory-views";
import type { WasteRow } from "@/lib/types/inventory-views";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate } from "@/lib/utils/date";

export default function WastePage() {
  const { rows, loading, error } = useWasteLog();
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

      <KpiGrid>
        <KpiCard label="Waste Entries" value={loading ? "…" : rows.length} icon={Trash2} color="red" />
        <KpiCard label="Value Wasted" value={loading ? "…" : formatCurrency(totalValue)} icon={Wallet} color="amber" />
      </KpiGrid>

      {error ? (
        <EmptyState title="Couldn't load the waste log" description={error} />
      ) : (
        <DataTable columns={columns} data={rows} searchPlaceholder="Search waste log…" emptyMessage={loading ? "Loading…" : "No waste logged yet."} />
      )}
    </div>
  );
}
