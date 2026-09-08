"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { DataTable } from "@/components/patterns/data-table";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useStaffRoster } from "@/lib/hooks/use-staff-roster";
import { useTimeEntriesData } from "@/lib/hooks/use-time-entries-collection";
import { useDtrSessions } from "@/lib/hooks/use-dtr-sessions";
import { useRoster } from "@/lib/hooks/use-roster";
import { useHolidays } from "@/lib/hooks/use-hr-reference-collections";
import { dayKey, formatMinutes } from "@/lib/utils/dtr";
import { dayAttendance, type DayFlag } from "@/lib/utils/attendance";
import { useAppSettings } from "@/lib/hooks/use-app-settings";
import { useRole } from "@/lib/rbac/use-role";
import { canManageHr } from "@/lib/rbac/roles";
import { Button } from "@/components/ui/button";
import { CloseTimeEntryDialog, type OpenDay } from "@/components/modules/staff/close-time-entry-dialog";

interface FlagRow {
  id: string;
  staffName: string;
  date: string;
  flag: DayFlag;
  clockIn?: string;
  clockOut?: string;
  totalMinutes: number;
  overtimeMinutes: number;
  lateMinutes: number;
  undertimeMinutes: number;
}

const FLAG_LABEL: Record<DayFlag, string> = {
  on_time: "On time",
  late: "Late",
  early_out: "Left early",
  missed_punch: "Missed punch",
  absent: "Absent",
  rest_day: "Rest day",
  holiday: "Holiday",
  on_leave: "On leave",
  unscheduled: "No schedule",
};

const columns: ColumnDef<FlagRow>[] = [
  { accessorKey: "staffName", header: "Staff" },
  { accessorKey: "date", header: "Date" },
  {
    accessorKey: "flag",
    header: "Flag",
    cell: ({ row }) => (
      <StatusBadge
        dot
        domain="attendance"
        status={row.original.flag}
        label={`${FLAG_LABEL[row.original.flag]}${row.original.lateMinutes ? ` ${row.original.lateMinutes}m` : ""}${row.original.undertimeMinutes ? ` −${row.original.undertimeMinutes}m` : ""}`}
      />
    ),
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
  const { sessions, now } = useDtrSessions();
  const { people, entryFor } = useRoster();
  const { holidays } = useHolidays();
  const { overtimeThresholdMinutes, tardinessGraceMinutes } = useAppSettings();
  const { role, isHr } = useRole();
  const manages = canManageHr(role, isHr);
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

  // Every recorded day, judged against the person's schedule (HR) rather than
  // the stored flag -- late, left early, rest day worked, holiday worked -- so
  // the list agrees with what the pay-period timesheet will say. Days with
  // nothing to flag are left out.
  const flaggedRows: FlagRow[] = timeEntries
    .map((t) => {
      const person = people.find((p) => p.staffId === t.staffId) ?? null;
      const entry = person ? entryFor(person, t.date) : null;
      const day = dayAttendance({
        day: t.date,
        // The roster already resolved pattern + override into today's shift;
        // hand it over as a one-day override so the judgement is the same.
        schedule: null,
        overrides: entry?.shift ? [{ date: t.date, start: entry.shift.start, end: entry.shift.end, isRestDay: false }] : entry?.restDay ? [{ date: t.date, start: null, end: null, isRestDay: true }] : [],
        sessions: sessions.filter((s) => s.staffId === t.staffId),
        holidays,
        leaves: [],
        overtimeThresholdMinutes,
        graceMinutes: tardinessGraceMinutes,
        now,
      });
      return {
        id: t.id,
        staffName: staffLabel(t.staffId),
        date: t.date,
        flag: day.flag,
        clockIn: t.clockIn,
        clockOut: t.clockOut,
        totalMinutes: day.paidMinutes,
        overtimeMinutes: day.overtimeMinutes,
        lateMinutes: day.lateMinutes,
        undertimeMinutes: day.undertimeMinutes,
      };
    })
    .filter((r) => r.flag !== "on_time" && r.flag !== "unscheduled")
    .sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="Timesheets" description="Days that need attention: missing clock-outs, lateness, undertime, rest days and holidays worked." />

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

      {manages ? (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-2 pt-6">
            <p className="text-sm text-muted-foreground">Approval is per pay period: each person&apos;s attendance summary is computed, checked and frozen for payroll under HR.</p>
            <Button asChild size="sm" variant="outline">
              <Link href="/hr/timesheets">
                Pay-period timesheets
                <ArrowRight />
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

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
