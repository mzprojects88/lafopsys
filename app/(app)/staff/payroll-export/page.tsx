"use client";

import { Download, Users, Clock, Timer, Flag } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/patterns/page-header";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useStaffRoster } from "@/lib/hooks/use-staff-roster";
import { useTimeEntriesData } from "@/lib/hooks/use-time-entries-collection";
import { formatMinutes } from "@/lib/utils/dtr";

export default function PayrollExportPage() {
  const { staff } = useStaffRoster();
  const { entries: timeEntries } = useTimeEntriesData();
  const totalMinutes = timeEntries.reduce((sum, t) => sum + t.totalMinutes, 0);
  const totalOvertimeMin = timeEntries.reduce((sum, t) => sum + t.overtimeMinutes, 0);
  const flaggedCount = timeEntries.filter((t) => t.flag !== "on_time").length;
  const activeStaff = staff.filter((s) => s.active).length;

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Payroll Export"
        description="Payroll-ready export of the current period's timesheets."
        action={
          <Button onClick={() => toast.success("Export generated — payroll_2026-08.csv (demo)")}>
            <Download />
            Export CSV / XLSX
          </Button>
        }
      />

      <KpiGrid>
        <KpiCard label="Active Staff" value={activeStaff} icon={Users} color="cyan" />
        <KpiCard label="Total Hours" value={formatMinutes(totalMinutes)} sublabel={`${timeEntries.length} time entries`} icon={Clock} color="blue" />
        <KpiCard label="Total Overtime" value={formatMinutes(totalOvertimeMin)} icon={Timer} color="amber" />
        <KpiCard label="Flagged Entries" value={flaggedCount} icon={Flag} color="rose" />
      </KpiGrid>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Export Preview</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            The real export produces a payroll-ready CSV/XLSX with regular hours, overtime, and rest-day
            calculations per staff member. This prototype has no file generation — the button above shows
            a toast confirmation only.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
