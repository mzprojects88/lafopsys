"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { PageHeader } from "@/components/patterns/page-header";
import { DataTable } from "@/components/patterns/data-table";
import { Badge } from "@/components/ui/badge";
import { careCartLogs, volunteers } from "@/lib/mock-data";
import type { CareCartLog } from "@/lib/types/house-ops";
import { formatDate } from "@/lib/utils/date";

const columns: ColumnDef<CareCartLog>[] = [
  { accessorKey: "date", header: "Date", cell: ({ row }) => formatDate(row.original.date) },
  { accessorKey: "timeSlot", header: "Time Slot" },
  { accessorKey: "itemsServed", header: "Items Served" },
  { accessorKey: "headcount", header: "Headcount" },
  {
    accessorKey: "source",
    header: "Source",
    cell: ({ row }) =>
      row.original.source ? (
        <Badge variant="secondary">{row.original.source}</Badge>
      ) : (
        <span className="text-xs text-muted-foreground">Unknown</span>
      ),
  },
  {
    id: "volunteer",
    header: "Volunteer",
    cell: ({ row }) => {
      const v = volunteers.find((vol) => vol.id === row.original.volunteerId);
      return v ? `${v.firstName} ${v.lastName}` : "—";
    },
  },
];

export default function CareCartPage() {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Care Cart"
        description="Service log by time slot — 10:00 / 12:00 / 14:00 / 17:00 ER round (real ledger data logs 10:00 & 14:00 as one combined window)."
      />
      <DataTable columns={columns} data={careCartLogs} searchPlaceholder="Search items served…" />
    </div>
  );
}
