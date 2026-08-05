"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { PageHeader } from "@/components/patterns/page-header";
import { DataTable } from "@/components/patterns/data-table";
import { StatusBadge } from "@/components/patterns/status-badge";
import { ApprovalQueue, type ApprovalQueueItem } from "@/components/patterns/approval-queue";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { staff, timesheetApprovals as seedApprovals, timeEntries } from "@/lib/mock-data";
import { useLocalCollection } from "@/lib/store/use-mock-store";
import type { TimesheetApproval } from "@/lib/types/staff";

interface FlagRow {
  id: string;
  staffName: string;
  date: string;
  flag: string;
  clockIn?: string;
  clockOut?: string;
  overtimeMinutes: number;
}

const columns: ColumnDef<FlagRow>[] = [
  { accessorKey: "staffName", header: "Staff" },
  { accessorKey: "date", header: "Date" },
  {
    accessorKey: "flag",
    header: "Flag",
    cell: ({ row }) => <StatusBadge dot domain="timesheet" status={row.original.flag === "on_time" ? "approved" : "flagged"} label={row.original.flag.replace("_", " ")} />,
  },
  { accessorKey: "clockIn", header: "Clock In", cell: ({ row }) => row.original.clockIn ?? "—" },
  { accessorKey: "clockOut", header: "Clock Out", cell: ({ row }) => row.original.clockOut ?? "—" },
  { accessorKey: "overtimeMinutes", header: "OT (min)" },
];

export default function TimesheetsPage() {
  const { items, updateItem } = useLocalCollection<TimesheetApproval>("timesheet-approvals", seedApprovals);

  const pending: ApprovalQueueItem[] = items
    .filter((a) => a.status === "pending")
    .map((a) => {
      const entry = timeEntries.find((t) => t.id === a.timeEntryId);
      const person = staff.find((s) => s.id === a.staffId);
      return {
        id: a.id,
        title: `${person?.firstName} ${person?.lastName} — ${entry?.date}`,
        subtitle: `${entry?.flag.replace("_", " ")}${a.adjustmentReason ? " · " + a.adjustmentReason : ""}`,
      };
    });

  const flaggedRows: FlagRow[] = timeEntries
    .filter((t) => t.flag !== "on_time")
    .map((t) => {
      const person = staff.find((s) => s.id === t.staffId);
      return {
        id: t.id,
        staffName: `${person?.firstName} ${person?.lastName}`,
        date: t.date,
        flag: t.flag,
        clockIn: t.clockIn,
        clockOut: t.clockOut,
        overtimeMinutes: t.overtimeMinutes,
      };
    });

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="Timesheets" description="Late / early-out / missed-punch flags and approval queue." />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pending Approval</CardTitle>
        </CardHeader>
        <CardContent>
          <ApprovalQueue
            items={pending}
            onApprove={(id, reason) => {
              updateItem(id, { status: "approved", adjustmentReason: reason || undefined });
              toast.success("Timesheet approved");
            }}
            onReject={(id, reason) => {
              updateItem(id, { status: "rejected", adjustmentReason: reason });
              toast.error("Timesheet rejected");
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All Flags</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable columns={columns} data={flaggedRows} searchPlaceholder="Search staff…" />
        </CardContent>
      </Card>
    </div>
  );
}
