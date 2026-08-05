"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { PageHeader } from "@/components/patterns/page-header";
import { DataTable } from "@/components/patterns/data-table";
import { activitySessions } from "@/lib/mock-data";
import type { ActivitySession } from "@/lib/types/house-ops";
import { formatDate } from "@/lib/utils/date";

const columns: ColumnDef<ActivitySession>[] = [
  { accessorKey: "date", header: "Date", cell: ({ row }) => formatDate(row.original.date) },
  { accessorKey: "title", header: "Session" },
  { accessorKey: "participants", header: "Participants" },
  { accessorKey: "volunteerCount", header: "Volunteers" },
  { accessorKey: "facilitator", header: "Facilitator" },
  { accessorKey: "hours", header: "Hours" },
];

export default function ActivityCenterPage() {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="Activity Center @ NCH" description="Session log: participants, hours, volunteers, facilitator." />
      <DataTable columns={columns} data={activitySessions} searchPlaceholder="Search sessions…" />
    </div>
  );
}
