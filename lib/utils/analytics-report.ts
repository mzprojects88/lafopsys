// The Analytics page as a printable report and as the figures the AI compares (Nov 2026). Pure:
// the page hands over the charts it drew (title, description, rows, series) for this range and
// the previous one; this file turns them into the ReportSpec and the AnalysisInput.

import type { AnalysisInput } from "../ai/report-analysis.ts";
import type { ReportSpec } from "../pdf/report-doc.ts";

export interface ChartDef {
  title: string;
  description: string;
  note?: string;
  kind: "bar" | "line" | "rank";
  stacked?: boolean;
  /** The row field that names each bar: "label" for time, "name" for a ranking. */
  xKey: string;
  data: Record<string, string | number>[];
  series: { key: string; label: string }[];
  csvName: string;
}

export interface AnalyticsKpi {
  label: string;
  value: string;
  current: number;
  previous: number;
}

const num = (n: number) => (Number.isInteger(n) ? n.toLocaleString("en-US") : n.toLocaleString("en-US", { maximumFractionDigits: 1 }));

/** "+20%", "-5%", "new" (from nothing), or "" when both are nothing. */
function change(current: number, previous: number): string {
  if (previous === 0) return current === 0 ? "" : "new";
  const pct = Math.round(((current - previous) / previous) * 100);
  return `${pct >= 0 ? "+" : ""}${pct}%`;
}

const sum = (c: ChartDef, key: string) => c.data.reduce((s, r) => s + Number(r[key] ?? 0), 0);

export function analyticsReport(args: { charts: ChartDef[]; previous: ChartDef[]; kpis: AnalyticsKpi[]; period: string; previousPeriod: string; filters: string[] }): { spec: ReportSpec; input: AnalysisInput } {
  const { charts, previous, kpis, period, previousPeriod, filters } = args;
  const kpiSection = kpis.length
    ? {
        heading: "Patients",
        description: "Bed nights, families served, new visits and nights per visit in the range, from the nightly record and the admission board.",
        kpis: kpis.map((k) => ({ label: k.label, value: k.value, previous: num(k.previous), change: change(k.current, k.previous) })),
        input: { heading: "Patients", kpis: kpis.map((k) => ({ label: k.label, value: k.current, previous: k.previous })) },
      }
    : null;
  const sections = charts.map((c) => {
    const prev = previous.find((p) => p.title === c.title);
    const totals = c.series.map((s) => ({ label: s.label, cur: sum(c, s.key), prev: prev ? sum(prev, s.key) : 0 }));
    const labels = c.data.map((r) => String(r[c.xKey] ?? ""));
    return {
      heading: c.title,
      description: [c.description, c.note].filter(Boolean).join(" "),
      kpis: c.kind === "rank" ? undefined : totals.map((t) => ({ label: t.label, value: num(t.cur), previous: num(t.prev), change: change(t.cur, t.prev) })),
      table: { columns: [c.xKey === "name" ? "Group" : "Period", ...c.series.map((s) => s.label)], rows: c.data.map((r) => [String(r[c.xKey] ?? ""), ...c.series.map((s) => Number(r[s.key] ?? 0))]), totals: c.kind === "rank" ? undefined : ["Total", ...totals.map((t) => t.cur)] },
      chart: { kind: (c.kind === "rank" ? "rank" : c.stacked ? "stacked" : "bar") as "rank" | "stacked" | "bar", labels, series: c.series.map((s) => ({ label: s.label, values: c.data.map((r) => Number(r[s.key] ?? 0)) })) },
      input: {
        heading: c.title,
        description: c.description,
        kpis: c.kind === "rank" ? undefined : totals.map((t) => ({ label: t.label, value: t.cur, previous: t.prev })),
        columns: c.kind === "rank" ? ["Group", ...c.series.map((s) => s.label)] : undefined,
        rows: c.kind === "rank" ? c.data.slice(0, 12).map((r) => [String(r[c.xKey] ?? ""), ...c.series.map((s) => Number(r[s.key] ?? 0))]) : undefined,
      },
    };
  });
  const all = [...(kpiSection ? [kpiSection] : []), ...sections];
  return {
    spec: { title: "Analytics Report", subtitle: "Everything the house records, for the range, from the live records", period, previousPeriod, filters: filters.length ? filters : undefined, sections: all.map((s) => ({ heading: s.heading, description: s.description, kpis: s.kpis, table: "table" in s ? s.table : undefined, chart: "chart" in s ? s.chart : undefined })) },
    input: { title: "Analytics Report", period, previousPeriod, sections: all.map((s) => s.input) },
  };
}
