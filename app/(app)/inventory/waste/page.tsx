"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { PageHeader } from "@/components/patterns/page-header";
import { DataTable } from "@/components/patterns/data-table";
import { inventoryTxns, inventoryItems, unitsOfMeasure } from "@/lib/mock-data";
import type { InventoryTxn } from "@/lib/types/inventory";
import { formatDate } from "@/lib/utils/date";

const wasteTxns = inventoryTxns.filter((t) => t.type === "waste");

const columns: ColumnDef<InventoryTxn>[] = [
  { accessorKey: "date", header: "Date", cell: ({ row }) => formatDate(row.original.date) },
  {
    id: "item",
    header: "Item",
    cell: ({ row }) => inventoryItems.find((i) => i.id === row.original.itemId)?.name ?? "—",
  },
  {
    id: "quantity",
    header: "Quantity",
    cell: ({ row }) => {
      const item = inventoryItems.find((i) => i.id === row.original.itemId);
      const uom = unitsOfMeasure.find((u) => u.id === item?.defaultUomId);
      return `${row.original.quantity} ${uom?.code ?? ""}`;
    },
  },
  { accessorKey: "reason", header: "Reason" },
  { accessorKey: "performedBy", header: "Performed By" },
];

export default function WastePage() {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="Waste Log" description="Tracked with reason, for donor reporting." />
      <DataTable columns={columns} data={wasteTxns} searchPlaceholder="Search waste log…" />
    </div>
  );
}
