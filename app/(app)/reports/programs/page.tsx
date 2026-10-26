"use client";

import * as React from "react";
import { Download, Pencil } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { EmptyState } from "@/components/patterns/empty-state";
import { LoadingState } from "@/components/patterns/loading-state";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ProgramImpactGrid } from "@/components/modules/reports/program-impact-grid";
import { PriorYearsDialog } from "@/components/modules/reports/prior-years-dialog";
import { useProgramHistory, useProgramImpact } from "@/lib/hooks/use-program-impact";
import { useRole } from "@/lib/rbac/use-role";
import { holdsPower } from "@/lib/rbac/roles";
import { DASHBOARD_LINES, impactCsv, ytd } from "@/lib/utils/program-impact";
import { downloadCsv } from "@/lib/utils/csv";
import { todayIso } from "@/lib/utils/date";

/**
 * Reports > Programs (0112): the sheet's "Report" and "Website Dashboard", computed live from the
 * app's records -- bed nights x people with the child, trips x passengers, meal ticks, Care Cart
 * runs, Center sessions -- with the sheet's figure beside each month until that source is switched off.
 */
export default function ProgramsReportPage() {
  const today = todayIso();
  const currentYear = Number(today.slice(0, 4));
  const currentMonth = Number(today.slice(5, 7));
  const [year, setYear] = React.useState(currentYear);
  const { rows, error, loading } = useProgramImpact(year);
  const { history } = useProgramHistory();
  const { roles } = useRole();
  const canTypeHistory = roles.includes("admin") || holdsPower(roles, "finance_work");
  const [editing, setEditing] = React.useState(false);
  const throughMonth = year === currentYear ? currentMonth : 12;
  const priorYears = [year - 2, year - 1];
  const prior = (y: number, line: string) => history.find((h) => h.year === y && h.line === line)?.value;

  const figures = (Object.entries(DASHBOARD_LINES) as [keyof typeof DASHBOARD_LINES, (typeof DASHBOARD_LINES)[keyof typeof DASHBOARD_LINES]][]).map(([key, lines]) => ({
    key,
    label: { housing: "Housing", transportation: "Transportation", meals: "Meals", center: "LAF Center @ NCH", care_cart: "Care Cart" }[key],
    ytd: lines.reduce((s, l) => s + ytd(rows, l, throughMonth), 0),
  }));

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Programs report"
        description="Housing, transportation, meals, Care Cart, LAF Center and CAF by month and year to date, from the app's records. The sheet's figure stays beside each month until that source is switched off in Settings."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger className="w-28" aria-label="Year">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[currentYear, currentYear - 1].map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {canTypeHistory ? (
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                <Pencil className="size-3.5" /> Prior years
              </Button>
            ) : null}
            <Button variant="outline" size="sm" disabled={loading || rows.length === 0} onClick={() => downloadCsv(impactCsv(rows, year, throughMonth), `programs-report-${year}.csv`)}>
              <Download className="size-3.5" /> CSV
            </Button>
          </div>
        }
      />
      <KpiGrid>
        {figures.map((f) => (
          <KpiCard
            key={f.key}
            label={`${f.label} · ${year} YTD`}
            value={f.ytd.toLocaleString()}
            sublabel={priorYears.map((y) => `${y}: ${prior(y, f.key)?.toLocaleString() ?? "—"}`).join(" · ")}
          />
        ))}
      </KpiGrid>
      {error ? (
        <EmptyState title="Couldn't load the report" description={error} />
      ) : loading ? (
        <LoadingState />
      ) : (
        <ProgramImpactGrid rows={rows} year={year} throughMonth={throughMonth} currentMonth={year === currentYear ? currentMonth : 12} />
      )}
      {editing ? <PriorYearsDialog years={priorYears} onClose={() => setEditing(false)} /> : null}
    </div>
  );
}
