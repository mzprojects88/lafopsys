"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { DataTable } from "@/components/patterns/data-table";
import { StatusBadge } from "@/components/patterns/status-badge";
import { ApprovalQueue, type ApprovalQueueItem } from "@/components/patterns/approval-queue";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useStaffRoster } from "@/lib/hooks/use-staff-roster";
import { useTimeEntriesData } from "@/lib/hooks/use-time-entries-collection";
import { useTimesheetApprovalsData } from "@/lib/hooks/use-timesheet-approvals-collection";
import { dayKey, formatMinutes, splitOvertime } from "@/lib/utils/dtr";
import { useAppSettings } from "@/lib/hooks/use-app-settings";
import { useRole } from "@/lib/rbac/use-role";
import { Button } from "@/components/ui/button";
import { CloseTimeEntryDialog, type OpenDay } from "@/components/modules/staff/close-time-entry-dialog";

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
  {
    accessorKey: "overtimeMinutes",
    header: "Overtime",
    cell: ({ row }) =>
      row.original.overtimeMinutes > 0 ? (
        <span className="tabular-nums text-amber-600 dark:text-amber-400">{formatMinutes(row.original.overtimeMinutes)}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
];

export default function TimesheetsPage() {
  const { staff } = useStaffRoster();
  const { entries: timeEntries } = useTimeEntriesData();
  const { approvals, updateStatus } = useTimesheetApprovalsData();
  const { overtimeThresholdMinutes } = useAppSettings();
  const { role } = useRole();
  const [closing, setClosing] = React.useState<OpenDay | null>(null);

  const staffLabel = (staffId: string) => {
    const person = staff.find((s) => s.id === staffId);
    return person ? `${person.firstName} ${person.lastName}` : "Unknown staff";
  };

  // A day that was clocked into and never out of reads as zero hours worked.
  // Derived from the record rather than from time_entries.flag, because the
  // flag is only ever set as a side effect of somebody's NEXT clock-in -- so a
  // staff member who has not been back since leaves the day invisible. Today's
  // open day is excluded: that is someone still at work, not a mistake.
  const today = dayKey(new Date());
  const openDays = timeEntries
    .filter((t) => !!t.clockIn && !t.clockOut && t.date < today)
    .sort((a, b) => b.date.localeCompare(a.date));

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
      return {
        id: t.id,
        staffName: staffLabel(t.staffId),
        date: t.date,
        flag: t.flag,
        clockIn: t.clockIn,
        clockOut: t.clockOut,
        totalMinutes: t.totalMinutes,
        overtimeMinutes: splitOvertime(t.totalMinutes, overtimeThresholdMinutes).overtime,
      };
    });

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="Timesheets" description="Days that need attention, flags, and the approval queue." />

      {openDays.length > 0 ? (
        <Card className="border-rose-200 dark:border-rose-900/60">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-4 text-rose-600 dark:text-rose-400" />
              Missing a clock-out
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              These days were clocked into and never out of, so they count as no hours worked. An admin can
              add the time that was actually worked; the original record is kept as it stands.
            </p>
            {openDays.map((entry) => (
              <div
                key={entry.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{staffLabel(entry.staffId)}</p>
                  <p className="text-xs text-muted-foreground">
                    {entry.date} · clocked in {entry.clockIn} · no clock-out
                  </p>
                </div>
                {role === "admin" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setClosing({
                        timeEntryId: entry.id,
                        staffName: staffLabel(entry.staffId),
                        date: entry.date,
                        clockIn: entry.clockIn ?? "",
                      })
                    }
                  >
                    Set the clock-out time
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground">An admin can correct this</span>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

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

      <CloseTimeEntryDialog day={closing} onOpenChange={(open) => (open ? undefined : setClosing(null))} />
    </div>
  );
}
