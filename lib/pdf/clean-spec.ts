// What a page may send to be printed (app/api/report-pdf): the ReportSpec rebuilt field by field, every string cut to
// size and every number checked, so nothing but the report's own shape reaches the PDF. Shared with the tests and the
// sample script, so a graph that prints in a sample prints in a real download too.
import type { ChartKind, ChartRow, ReportChart, ReportSpec } from "./report-doc.ts";

const LIMITS = { sections: 40, rows: 2000, text: 4000, graphs: 12 };
const KINDS = new Set<ChartKind>(["bar", "hbar", "rank", "stacked", "line", "area", "combo", "pie", "donut", "gauge", "scorecard", "variance", "kpi"]);
const str = (v: unknown, max = 200) => (typeof v === "string" ? v.slice(0, max) : undefined);
const numOr = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const cell = (v: unknown): string | number => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" ? v.slice(0, 120) : "");

function cleanChart(raw: unknown): ReportChart | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const c = raw as Record<string, unknown>;
  if (!KINDS.has(c.kind as ChartKind) || !Array.isArray(c.labels) || !Array.isArray(c.series)) return undefined;
  const kind = c.kind as ChartKind;
  // Only the variance graph draws below zero.
  const value = (v: unknown) => (kind === "variance" ? (numOr(v) ?? 0) : Math.max(0, numOr(v) ?? 0));
  const rows = Array.isArray(c.rows)
    ? (c.rows as unknown[]).slice(0, 30).flatMap((r): ChartRow[] => {
        const o = (r ?? {}) as Record<string, unknown>;
        const label = str(o.label, 80);
        return label ? [{ label, value: value(o.value), ytd: numOr(o.ytd), goal: numOr(o.goal), previous: numOr(o.previous), text: str(o.text, 80), sub: str(o.sub, 120), good: typeof o.good === "boolean" ? o.good : null }] : [];
      })
    : undefined;
  const ref = c.reference as Record<string, unknown> | undefined;
  return {
    kind,
    labels: (c.labels as unknown[]).slice(0, 400).map((l) => str(l, 60) ?? ""),
    series: (c.series as unknown[]).slice(0, 8).flatMap((x) => {
      const xx = (x ?? {}) as Record<string, unknown>;
      const label = str(xx.label, 60);
      return label && Array.isArray(xx.values) ? [{ label, values: (xx.values as unknown[]).slice(0, 400).map(value) }] : [];
    }),
    rows,
    title: str(c.title, 120),
    note: str(c.note, 160),
    highlight: numOr(c.highlight),
    reference: ref && numOr(ref.value) != null ? { value: Math.max(0, numOr(ref.value)!), label: str(ref.label, 60) ?? "" } : undefined,
    pace: numOr(c.pace) == null ? undefined : Math.min(1, Math.max(0, numOr(c.pace)!)),
    values: typeof c.values === "boolean" ? c.values : undefined,
  };
}

export function cleanSpec(raw: unknown): ReportSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const title = str(r.title, 120);
  const period = str(r.period, 80);
  if (!title || !period || !Array.isArray(r.sections)) return null;
  const sections: ReportSpec["sections"] = [];
  for (const s of (r.sections as unknown[]).slice(0, LIMITS.sections)) {
    if (!s || typeof s !== "object") continue;
    const o = s as Record<string, unknown>;
    const heading = str(o.heading, 120);
    if (!heading) continue;
    const kpis = Array.isArray(o.kpis)
      ? (o.kpis as unknown[]).slice(0, 24).flatMap((k) => {
          const kk = (k ?? {}) as Record<string, unknown>;
          const label = str(kk.label, 80);
          const value = str(kk.value, 40);
          return label && value !== undefined ? [{ label, value, previous: str(kk.previous, 40), change: str(kk.change, 24) }] : [];
        })
      : undefined;
    const t = o.table as Record<string, unknown> | undefined;
    const table =
      t && Array.isArray(t.columns) && Array.isArray(t.rows)
        ? {
            columns: (t.columns as unknown[]).slice(0, 16).map((c) => str(c, 60) ?? ""),
            rows: (t.rows as unknown[]).slice(0, LIMITS.rows).map((row) => (Array.isArray(row) ? row.slice(0, 16).map(cell) : [])),
            totals: Array.isArray(t.totals) ? (t.totals as unknown[]).slice(0, 16).map(cell) : undefined,
          }
        : undefined;
    const graphs = Array.isArray(o.graphs) ? (o.graphs as unknown[]).slice(0, LIMITS.graphs).flatMap((g) => cleanChart(g) ?? []) : undefined;
    sections.push({ heading, description: str(o.description, 600), kpis, table, chart: cleanChart(o.chart), graphs: graphs?.length ? graphs : undefined, analysis: str(o.analysis, LIMITS.text) });
  }
  return {
    title,
    subtitle: str(r.subtitle, 200),
    period,
    previousPeriod: str(r.previousPeriod, 80),
    filters: Array.isArray(r.filters) ? (r.filters as unknown[]).slice(0, 20).flatMap((f) => (typeof f === "string" ? [f.slice(0, 120)] : [])) : undefined,
    analysis: str(r.analysis, LIMITS.text),
    sections,
  };
}
