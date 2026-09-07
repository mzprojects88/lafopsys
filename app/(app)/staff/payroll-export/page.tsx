"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, Clock, Download, Timer, Users } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { DataTable } from "@/components/patterns/data-table";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useStaffRoster } from "@/lib/hooks/use-staff-roster";
import { useTimeEntriesData } from "@/lib/hooks/use-time-entries-collection";
import { useAppSettings } from "@/lib/hooks/use-app-settings";
import { dayKey, formatMinutes, monthKey, splitOvertime } from "@/lib/utils/dtr";
import { csvLines, downloadCsv } from "@/lib/utils/csv";

/**
 * The payroll export, for real.
 *
 * This page used to show a Download button that popped a toast saying
 * "payroll_2026-08.csv (demo)" and produced no file -- worse than having no
 * button, because it looked like it had worked. It now builds the CSV from
 * ops.time_entries in the browser: no server round trip, and the figures are
 * exactly the ones on screen.
 *
 * Regular and overtime are split here rather than read from a column, because
 * the split depends on a threshold an admin can change (0029 dropped the
 * never-written overtime_minutes). Hours themselves always come from
 * total_minutes, which the punch route computes from the punches.
 */

/** Hours as a decimal, which is what a payroll spreadsheet wants to multiply
 * by a rate -- `7h 45m` is for reading, `7.75` is for arithmetic. */
function decimalHours(minutes: number): string {
  return (Math.max(0, minutes) / 60).toFixed(2);
}

interface StaffTotals {
  id: string;
  name: string;
  daysWorked: number;
  regularMinutes: number;
  overtimeMinutes: number;
  totalMinutes: number;
  openDays: number;
}

export default function PayrollExportPage() {
  const { staff } = useStaffRoster();
  const { entries: timeEntries } = useTimeEntriesData();
  const { overtimeThresholdMinutes } = useAppSettings();

  const [period, setPeriod] = React.useState(() => monthKey(dayKey(new Date())));

  const inPeriod = React.useMemo(
    () => timeEntries.filter((t) => monthKey(t.date) === period),
    [timeEntries, period]
  );

  const rows: StaffTotals[] = React.useMemo(() => {
    const byStaff = new Map<string, StaffTotals>();
    for (const entry of inPeriod) {
      const person = staff.find((s) => s.id === entry.staffId);
      const name = person ? `${person.firstName} ${person.lastName}` : "Unknown staff";
      const current =
        byStaff.get(entry.staffId) ??
        { id: entry.staffId, name, daysWorked: 0, regularMinutes: 0, overtimeMinutes: 0, totalMinutes: 0, openDays: 0 };

      const { regular, overtime } = splitOvertime(entry.totalMinutes, overtimeThresholdMinutes);
      current.regularMinutes += regular;
      current.overtimeMinutes += overtime;
      current.totalMinutes += entry.totalMinutes;
      if (entry.totalMinutes > 0) current.daysWorked += 1;
      // A day clocked into and never out of contributes nothing, so the totals
      // below it are understated until somebody corrects it on /staff/timesheets.
      if (entry.clockIn && !entry.clockOut) current.openDays += 1;
      byStaff.set(entry.staffId, current);
    }
    return [...byStaff.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [inPeriod, staff, overtimeThresholdMinutes]);

  const totalMinutes = rows.reduce((sum, r) => sum + r.totalMinutes, 0);
  const totalOvertime = rows.reduce((sum, r) => sum + r.overtimeMinutes, 0);
  const openDays = rows.reduce((sum, r) => sum + r.openDays, 0);

  const columns: ColumnDef<StaffTotals>[] = [
    { accessorKey: "name", header: "Staff" },
    { accessorKey: "daysWorked", header: "Days" },
    {
      id: "regular",
      header: "Regular",
      accessorFn: (r) => r.regularMinutes,
      cell: ({ row }) => <span className="tabular-nums">{formatMinutes(row.original.regularMinutes)}</span>,
    },
    {
      id: "overtime",
      header: "Overtime",
      accessorFn: (r) => r.overtimeMinutes,
      cell: ({ row }) =>
        row.original.overtimeMinutes > 0 ? (
          <span className="tabular-nums text-amber-600 dark:text-amber-400">{formatMinutes(row.original.overtimeMinutes)}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: "total",
      header: "Total",
      accessorFn: (r) => r.totalMinutes,
      cell: ({ row }) => (
        <span className="tabular-nums font-medium">
          {formatMinutes(row.original.totalMinutes)}
          <span className="pl-1 text-xs font-normal text-muted-foreground">({decimalHours(row.original.totalMinutes)}h)</span>
        </span>
      ),
    },
    {
      id: "openDays",
      header: "Needs a clock-out",
      accessorFn: (r) => r.openDays,
      cell: ({ row }) =>
        row.original.openDays > 0 ? (
          <span className="text-rose-600 dark:text-rose-400">{row.original.openDays}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ];

  function exportSummary() {
    downloadCsv(
      csvLines(
        ["Staff", "Days worked", "Regular hours", "Overtime hours", "Total hours", "Days missing a clock-out"],
        rows.map((r) => [
          r.name,
          String(r.daysWorked),
          decimalHours(r.regularMinutes),
          decimalHours(r.overtimeMinutes),
          decimalHours(r.totalMinutes),
          String(r.openDays),
        ])
      ),
      `payroll-summary-${period}.csv`
    );
  }

  function exportDaily() {
    const detail = [...inPeriod].sort((a, b) => a.date.localeCompare(b.date) || a.staffId.localeCompare(b.staffId));
    downloadCsv(
      csvLines(
        ["Staff", "Date", "Clock in", "Clock out", "Regular hours", "Overtime hours", "Total hours", "Flag"],
        detail.map((entry) => {
          const person = staff.find((s) => s.id === entry.staffId);
          const { regular, overtime } = splitOvertime(entry.totalMinutes, overtimeThresholdMinutes);
          return [
            person ? `${person.firstName} ${person.lastName}` : "Unknown staff",
            entry.date,
            entry.clockIn ?? "",
            entry.clockOut ?? "",
            decimalHours(regular),
            decimalHours(overtime),
            decimalHours(entry.totalMinutes),
            entry.clockIn && !entry.clockOut ? "missing clock-out" : entry.flag.replace("_", " "),
          ];
        })
      ),
      `payroll-daily-${period}.csv`
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Payroll Export"
        description="Hours for a pay period, split into regular and overtime, ready for the payroll spreadsheet."
        action={
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="payroll-period" className="text-xs">
                Period
              </Label>
              <Input
                id="payroll-period"
                type="month"
                className="w-40"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
              />
            </div>
            <Button variant="outline" disabled={rows.length === 0} onClick={exportSummary}>
              <Download />
              Summary
            </Button>
            <Button disabled={inPeriod.length === 0} onClick={exportDaily}>
              <Download />
              Daily detail
            </Button>
          </div>
        }
      />

      <KpiGrid>
        <KpiCard label="Staff With Hours" value={rows.length} sublabel={`${staff.filter((s) => s.active).length} active on the roster`} icon={Users} color="cyan" />
        <KpiCard label="Total Hours" value={formatMinutes(totalMinutes)} sublabel={`${inPeriod.length} days recorded`} icon={Clock} color="blue" />
        <KpiCard
          label="Total Overtime"
          value={formatMinutes(totalOvertime)}
          sublabel={`Past ${formatMinutes(overtimeThresholdMinutes)} a day`}
          icon={Timer}
          color="amber"
        />
        <KpiCard label="Missing A Clock-out" value={openDays} sublabel={openDays > 0 ? "Hours below are understated" : "Nothing outstanding"} icon={AlertTriangle} color="rose" />
      </KpiGrid>

      {openDays > 0 ? (
        <Card className="border-rose-200 dark:border-rose-900/60">
          <CardContent className="flex items-start gap-2 py-3 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-rose-600 dark:text-rose-400" />
            <span>
              {openDays} {openDays === 1 ? "day was" : "days were"} clocked into and never out of, so
              {openDays === 1 ? " it counts" : " they count"} as zero hours here. Fix
              {openDays === 1 ? " it" : " them"} on <strong>Timesheets</strong> before running payroll.
            </span>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Hours by staff member</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={rows}
            searchPlaceholder="Search staff…"
            emptyMessage="No hours recorded in this period."
          />
        </CardContent>
      </Card>
    </div>
  );
}
