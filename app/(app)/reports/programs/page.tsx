"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Download, Pencil } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { EmptyState } from "@/components/patterns/empty-state";
import { LoadingState } from "@/components/patterns/loading-state";
import { Button } from "@/components/ui/button";
import { PeriodPicker, periodStateWindow, type PeriodState } from "@/components/ui/period-picker";
import { ProgramImpactGrid } from "@/components/modules/reports/program-impact-grid";
import { PriorYearsDialog } from "@/components/modules/reports/prior-years-dialog";
import { AiAnalysisPanel, ReportToolbar, useReportAnalysis } from "@/components/modules/reports/report-ai";
import { useProgramHistory, useProgramImpact } from "@/lib/hooks/use-program-impact";
import { useRole } from "@/lib/rbac/use-role";
import { holdsPower } from "@/lib/rbac/roles";
import { DASHBOARD_LABELS, DASHBOARD_LINES, bucketsFor, impactCsv, programReport, total, type Grain } from "@/lib/utils/program-impact";
import { periodLabel, previousWindow, naturalGrain, type RangeKind } from "@/lib/utils/period";
import { downloadCsv } from "@/lib/utils/csv";
import { todayIso } from "@/lib/utils/date";

/** The columns a period is broken into: a day stands alone, a week shows its days, a month its weeks, longer ranges their months. */
function grainFor(kind: RangeKind, days: number): Grain {
  if (kind === "today" || kind === "week") return "day";
  if (kind === "month") return "week";
  if (kind === "custom") return days <= 14 ? "day" : days <= 120 ? "week" : "month";
  return "month";
}

/**
 * Reports > Programs (0112, any range since 0128): the sheet's "Report" and "Website Dashboard",
 * computed live from the app's records -- bed nights x people with the child, trips x passengers,
 * meal ticks, Care Cart runs, Center sessions -- for a day, a week, a month, a quarter, a year or
 * two dates, compared with the range before, with the sheet's figure beside each column until
 * that source is switched off. Prints as the branded PDF, with the AI's comparison when kept.
 */
export default function ProgramsReportPage() {
  return (
    <React.Suspense fallback={<LoadingState />}>
      <ProgramsReport />
    </React.Suspense>
  );
}

function ProgramsReport() {
  const router = useRouter();
  const params = useSearchParams();
  const today = todayIso();
  const state: PeriodState = React.useMemo(() => {
    const kind = (params.get("range") ?? "year") as RangeKind;
    return { kind: ["today", "week", "month", "quarter", "year", "custom"].includes(kind) ? kind : "year", anchor: params.get("at") ?? today, from: params.get("from") ?? undefined, to: params.get("to") ?? undefined };
  }, [params, today]);
  const setState = (next: PeriodState) => {
    const q = new URLSearchParams();
    q.set("range", next.kind);
    if (next.kind === "custom") {
      if (next.from) q.set("from", next.from);
      if (next.to) q.set("to", next.to);
    } else if (next.anchor !== today) q.set("at", next.anchor);
    router.replace(`/reports/programs?${q.toString()}`);
  };
  const window = periodStateWindow(state);
  const previous = previousWindow(state.kind, window);
  const grain = grainFor(state.kind, bucketsFor(window, "day").length);
  const buckets = bucketsFor(window, grain);
  const { rows, error, loading } = useProgramImpact(window, grain);
  const prev = useProgramImpact(previous, naturalGrain(previous) === "day" ? "day" : "month");
  const { history } = useProgramHistory();
  const { roles } = useRole();
  const canTypeHistory = roles.includes("admin") || holdsPower(roles, "finance_work");
  const [editing, setEditing] = React.useState(false);
  const ai = useReportAnalysis();
  const clearAnalysis = ai.clear;
  React.useEffect(() => clearAnalysis(), [window.from, window.to, clearAnalysis]);

  const period = periodLabel(state.kind, window);
  const previousPeriod = periodLabel(state.kind, previous);
  const year = Number(window.from.slice(0, 4));
  const priorYears = [year - 2, year - 1];
  const prior = (y: number, line: string) => history.find((h) => h.year === y && h.line === line)?.value;
  const report = () => programReport({ rows, previous: prev.rows, buckets, period, previousPeriod });

  const figures = (Object.keys(DASHBOARD_LINES) as (keyof typeof DASHBOARD_LINES)[]).map((key) => {
    const cur = DASHBOARD_LINES[key].reduce((s, l) => s + total(rows, l), 0);
    const before = DASHBOARD_LINES[key].reduce((s, l) => s + total(prev.rows, l), 0);
    return { key, label: DASHBOARD_LABELS[key], cur, before };
  });

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Programs report"
        description="Housing, transportation, meals, Care Cart, LAF Center and CAF for any range, from the app's records, compared with the range before. The sheet's figure stays beside each column until that source is switched off in Settings."
        action={
          <div className="flex flex-wrap items-center gap-2">
            {canTypeHistory ? (
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                <Pencil className="size-3.5" /> Prior years
              </Button>
            ) : null}
            <Button variant="outline" size="sm" disabled={loading || rows.length === 0} onClick={() => downloadCsv(impactCsv(rows, buckets), `programs-report-${window.from}-${window.to}.csv`)}>
              <Download className="size-3.5" /> CSV
            </Button>
          </div>
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4">
        <PeriodPicker value={state} onChange={setState} />
        <ReportToolbar ai={ai} buildSpec={() => report().spec} buildInput={() => report().input} filename={`LAF-Programs-Report-${window.from}-${window.to}.pdf`} />
      </div>
      <KpiGrid>
        {figures.map((f) => (
          <KpiCard
            key={f.key}
            label={`${f.label} · ${period}`}
            value={f.cur.toLocaleString()}
            sublabel={state.kind === "year" ? priorYears.map((y) => `${y}: ${prior(y, f.key)?.toLocaleString() ?? "—"}`).join(" · ") : `${previousPeriod}: ${f.before.toLocaleString()}`}
            deltaPct={f.before > 0 ? Math.round(((f.cur - f.before) / f.before) * 100) : undefined}
            deltaLabel={`vs ${previousPeriod}`}
          />
        ))}
      </KpiGrid>
      <AiAnalysisPanel text={ai.analysis?.overall} />
      {error ? <EmptyState title="Couldn't load the report" description={error} /> : loading ? <LoadingState /> : <ProgramImpactGrid rows={rows} buckets={buckets} analysis={ai.analysis?.sections} />}
      {editing ? <PriorYearsDialog years={priorYears} onClose={() => setEditing(false)} /> : null}
    </div>
  );
}
