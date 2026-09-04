"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { PageHeader } from "@/components/patterns/page-header";
import { DataTable } from "@/components/patterns/data-table";
import { StatusBadge } from "@/components/patterns/status-badge";
import { ApprovalQueue, type ApprovalQueueItem } from "@/components/patterns/approval-queue";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useStaffRoster } from "@/lib/hooks/use-staff-roster";
import { useTimeEntriesData } from "@/lib/hooks/use-time-entries-collection";
import { useTimesheetApprovalsData } from "@/lib/hooks/use-timesheet-approvals-collection";
import { formatMinutes } from "@/lib/utils/dtr";

interface FlagRow {
  id: string;
  staffName: string;
  date: string;
  flag: string;
  clockIn?: string;
  clockOut?: string;
  totalMinutes: number;
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
  // First in / latest out of the day (Manila). An out earlier than the in is
  // an overnight shift; hours come from the punches, not from these labels.
  { accessorKey: "totalMinutes", header: "Hours", cell: ({ row }) => <span className="tabular-nums">{formatMinutes(row.original.totalMinutes)}</span> },
  { accessorKey: "overtimeMinutes", header: "OT (min)" },
];

export default function TimesheetsPage() {
  const { staff } = useStaffRoster();
  const { entries: timeEntries } = useTimeEntriesData();
  const { approvals, updateStatus } = useTimesheetApprovalsData();

  const pending: ApprovalQueueItem[] = approvals
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
        totalMinutes: t.totalMinutes,
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
              updateStatus(id, "approved", reason || undefined);
              toast.success("Timesheet approved");
            }}
            onReject={(id, reason) => {
              updateStatus(id, "rejected", reason);
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
