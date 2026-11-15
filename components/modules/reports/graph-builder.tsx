"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, ChartArea, ChartBar, ChartColumn, ChartColumnStacked, ChartLine, ChartNoAxesCombined, ChartPie, Donut, Eye, EyeOff, Gauge, LayoutGrid, Pencil, Plus, SquareSigma, Trash2, TrendingUpDown, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { chartSvg, type ReportChart } from "@/lib/pdf/charts";
import { GENERATOR_SECTIONS } from "@/lib/utils/operations-report";
import { GRAPH_TYPES, SHOW_BY, graphProblem, graphRules, measureCatalogue, monthsAvailable, resolveGraph, sampleFigure, seriesAvailable, type GraphContext, type GraphDef, type GraphType } from "@/lib/utils/report-graphs";

const ICONS: Record<GraphType, LucideIcon> = {
  scorecard: LayoutGrid,
  bar: ChartColumn,
  hbar: ChartBar,
  stacked: ChartColumnStacked,
  line: ChartLine,
  area: ChartArea,
  combo: ChartNoAxesCombined,
  pie: ChartPie,
  donut: Donut,
  gauge: Gauge,
  variance: TrendingUpDown,
  kpi: SquareSigma,
};
const MAX_GRAPHS = 12;
const sectionLabel = (k: string) => (k === "top" ? "Top of the report" : (GENERATOR_SECTIONS.find((s) => s.key === k)?.label ?? k));

/** A report graph drawn exactly as the PDF draws it (the same drawing, as SVG). The SVG is built by our own code
 * from numbers and escaped text, never from markup typed by anyone. */
export function ChartPreview({ chart, className }: { chart: ReportChart; className?: string }) {
  const svg = React.useMemo(() => chartSvg(chart), [chart]);
  return <div role="img" aria-label={chart.title ?? "Graph"} className={`w-full [&>svg]:h-auto [&>svg]:w-full ${className ?? ""}`} dangerouslySetInnerHTML={{ __html: svg }} />;
}

/** The report's figures for the preview, with sample figures for any the report hasn't loaded (named in the note). */
function previewChart(g: GraphDef, context: GraphContext | null, comparisons: readonly ("previous" | "ytd" | "goal")[]): ReportChart {
  const months = context?.monthLabels.length || new Date().getMonth() + 1;
  const base: GraphContext = context ?? {
    figures: new Map(),
    sets: new Map(),
    period: "This period",
    previousPeriod: "Previous",
    ytdLabel: "YTD",
    goalYear: new Date().getFullYear(),
    bucketLabels: ["Week 1", "Week 2", "Week 3", "Week 4", "Week 5"],
    monthLabels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].slice(0, months),
    perYear: 52,
    comparisons: new Set(comparisons),
    pace: months / 12,
  };
  const figures = new Map(base.figures);
  const sets = new Map(base.sets);
  const sampled: string[] = [];
  for (const id of g.measures) {
    if (figures.has(id) || sets.has(id)) continue;
    if (id.startsWith("expenses.by_")) sets.set(id, ["5100 Food", "5932 Travel", "5210 Utilities", "5310 Fuel"].map((label, i) => ({ label, amount: 90_000 / (i + 1) })));
    else figures.set(id, sampleFigure(id, base.bucketLabels.length, base.monthLabels.length));
    sampled.push(id);
  }
  const chart = resolveGraph(g, { ...base, figures, sets, comparisons: new Set(comparisons) });
  const note = sampled.length ? `Sample figures${context ? " for what this report hasn't loaded" : ""}: the report's own figures replace them.` : undefined;
  return { ...chart, note: [chart.note, note].filter(Boolean).join(" ") || undefined };
}

/**
 * A profile's graphs (0152): the list (add, edit, hide, reorder, remove, at most twelve) and the editor of one graph
 * with its live preview, drawn as the PDF prints it.
 */
export function GraphsEditor({ graphs, onChange, sections, comparisons, context, onEditingChange }: { graphs: GraphDef[]; onChange: (g: GraphDef[]) => void; sections: string[]; comparisons: readonly ("previous" | "ytd" | "goal")[]; context: GraphContext | null; onEditingChange?: (open: boolean) => void }) {
  const [editing, setEditingState] = React.useState<GraphDef | null>(null);
  // The profile isn't saved while a graph is open (its changes would be lost).
  const setEditing = (g: GraphDef | null) => {
    setEditingState(g);
    onEditingChange?.(g != null);
  };
  const put = (g: GraphDef) => {
    onChange(graphs.some((x) => x.id === g.id) ? graphs.map((x) => (x.id === g.id ? g : x)) : [...graphs, g]);
    setEditing(null);
  };
  const shift = (i: number, d: number) => {
    const next = [...graphs];
    [next[i], next[i + d]] = [next[i + d]!, next[i]!];
    onChange(next);
  };
  if (editing) return <GraphForm initial={editing} sections={sections} comparisons={comparisons} context={context} onCancel={() => setEditing(null)} onDone={put} />;
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-theme-sm font-semibold">Graphs</h3>
        <Button
          size="sm"
          variant="outline"
          disabled={graphs.length >= MAX_GRAPHS}
          onClick={() => setEditing({ id: `g${Date.now().toString(36)}`, title: "", type: "scorecard", measures: [], showBy: "comparisons", place: "top" })}
        >
          <Plus className="size-4" /> Add graph
        </Button>
      </div>
      {graphs.length ? (
        <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
          {graphs.map((g, i) => {
            const Icon = ICONS[g.type];
            return (
              <li key={g.id} className={`flex items-center gap-2 px-3 py-1.5 text-theme-sm ${g.hidden ? "text-muted-foreground" : ""}`}>
                <Icon className="size-4 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{g.title}</span>
                  <span className="block text-theme-xs text-muted-foreground">
                    {GRAPH_TYPES.find((t) => t.type === g.type)?.label} · {sectionLabel(g.place)}
                    {g.hidden ? " · hidden" : ""}
                  </span>
                </span>
                <Button variant="ghost" size="icon-sm" aria-label={g.hidden ? `Show ${g.title}` : `Hide ${g.title}`} onClick={() => onChange(graphs.map((x) => (x.id === g.id ? { ...x, hidden: !x.hidden } : x)))}>{g.hidden ? <EyeOff /> : <Eye />}</Button>
                <Button variant="ghost" size="icon-sm" aria-label={`Edit ${g.title}`} onClick={() => setEditing(g)}><Pencil /></Button>
                <Button variant="ghost" size="icon-sm" disabled={i === 0} aria-label={`Move ${g.title} up`} onClick={() => shift(i, -1)}><ArrowUp /></Button>
                <Button variant="ghost" size="icon-sm" disabled={i === graphs.length - 1} aria-label={`Move ${g.title} down`} onClick={() => shift(i, 1)}><ArrowDown /></Button>
                <Button variant="ghost" size="icon-sm" aria-label={`Remove ${g.title}`} onClick={() => onChange(graphs.filter((x) => x.id !== g.id))}><Trash2 /></Button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-theme-xs text-muted-foreground">No graphs yet: add one. Every section still has its own graph (set above).</p>
      )}
      <p className="text-theme-xs text-muted-foreground">Hide a graph to keep it out of the report without losing it. A graph can use the figures of the sections ticked above.</p>
    </section>
  );
}

function GraphForm({ initial, sections, comparisons, context, onCancel, onDone }: { initial: GraphDef; sections: string[]; comparisons: readonly ("previous" | "ytd" | "goal")[]; context: GraphContext | null; onCancel: () => void; onDone: (g: GraphDef) => void }) {
  const [g, setG] = React.useState<GraphDef>(initial);
  const set = <K extends keyof GraphDef>(k: K, v: GraphDef[K]) => setG((o) => ({ ...o, [k]: v }));
  const rules = graphRules(g.type);
  const catalogue = React.useMemo(() => measureCatalogue().filter((m) => sections.includes(m.meta.section)), [sections]);
  const picked = catalogue.filter((m) => g.measures.includes(m.id));
  const unit = picked.find((m) => !m.set)?.unitName;
  const problem = graphProblem(g);
  const chart = React.useMemo(() => previewChart(g, context, comparisons), [g, context, comparisons]);
  const pickType = (type: GraphType) => {
    const r = graphRules(type);
    setG((o) => ({ ...o, type, showBy: r.showBy.includes(o.showBy) ? o.showBy : r.showBy[0]! }));
  };
  const toggle = (id: string, on: boolean) => set("measures", on ? [...g.measures, id] : g.measures.filter((x) => x !== id));

  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-xl border border-border p-3">
      <h3 className="text-theme-sm font-semibold">{initial.title ? `Edit graph: ${initial.title}` : "New graph"}</h3>
      <Field>
        <FieldLabel htmlFor="gb-title">Title</FieldLabel>
        <Input id="gb-title" maxLength={100} value={g.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Meals by month" />
      </Field>
      <div className="flex flex-col gap-1.5">
        <span className="text-theme-sm font-medium">Type</span>
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4" role="radiogroup" aria-label="Graph type">
          {GRAPH_TYPES.map((t) => {
            const Icon = ICONS[t.type];
            const on = g.type === t.type;
            return (
              <button
                key={t.type}
                type="button"
                role="radio"
                aria-checked={on}
                title={t.hint}
                onClick={() => pickType(t.type)}
                className={`flex flex-col items-center gap-1 rounded-lg border px-2 py-2 text-theme-xs ${on ? "border-brand-500 bg-brand-50 font-medium text-brand-600 dark:bg-brand-500/15" : "border-border hover:bg-muted"}`}
              >
                <Icon className="size-5" aria-hidden />
                {t.label}
              </button>
            );
          })}
        </div>
        <p className="text-theme-xs text-muted-foreground">{GRAPH_TYPES.find((t) => t.type === g.type)?.hint}.</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-theme-sm font-medium">Figures{rules.mixedUnits ? "" : unit ? ` (in ${unit})` : ""}</span>
        <div className="max-h-56 overflow-y-auto rounded-lg border border-border p-2">
          {sections.map((sec) => {
            const items = catalogue.filter((m) => m.meta.section === sec);
            if (!items.length) return null;
            return (
              <div key={sec} className="mb-2 last:mb-0">
                <p className="text-theme-xs font-semibold text-muted-foreground">{sectionLabel(sec)}</p>
                {items.map((m) => {
                  const on = g.measures.includes(m.id);
                  // One scale: figures in another unit can't join; a list (each account) goes alone.
                  const blocked = !on && ((!rules.mixedUnits && unit != null && m.unitName !== unit) || (m.set ? !rules.sets || g.measures.length > 0 : picked.some((x) => x.set)));
                  return (
                    <label key={m.id} className={`flex items-center gap-2 py-0.5 text-theme-sm ${blocked ? "opacity-50" : ""}`}>
                      <Checkbox checked={on} disabled={blocked} onCheckedChange={(v) => toggle(m.id, v === true)} />
                      <span className="min-w-0 flex-1 truncate">{m.meta.label}</span>
                      <span className="text-theme-xs text-muted-foreground">{m.unitName}</span>
                    </label>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field>
          <FieldLabel>Show</FieldLabel>
          <Select value={g.showBy} onValueChange={(v) => set("showBy", v as GraphDef["showBy"])}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {SHOW_BY.filter((s) => rules.showBy.includes(s.value)).map((s) => {
                // Over time and month by month only where the picked figures have them.
                const lacks = s.value === "over_time" ? picked.some((m) => !seriesAvailable(m.id)) : s.value === "months" ? picked.some((m) => !monthsAvailable(m.id)) : false;
                return <SelectItem key={s.value} value={s.value} disabled={lacks}>{s.label}{lacks ? " (not for these figures)" : ""}</SelectItem>;
              })}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel>Prints</FieldLabel>
          <Select value={g.place} onValueChange={(v) => set("place", v)}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{["top", ...sections].map((k) => <SelectItem key={k} value={k}>{k === "top" ? "Top of the report" : `In ${sectionLabel(k)}`}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-theme-sm">
        <label className="flex items-center gap-2"><Switch checked={g.values ?? true} onCheckedChange={(v) => set("values", v)} /> Values on the graph</label>
        {g.showBy === "over_time" || g.showBy === "months" ? <label className="flex items-center gap-2"><Switch checked={!!g.goalLine} onCheckedChange={(v) => set("goalLine", v)} /> Goal&apos;s pace line</label> : null}
        <label className="flex items-center gap-2"><Switch checked={!!g.hidden} onCheckedChange={(v) => set("hidden", v)} /> Hidden</label>
      </div>
      <div className="rounded-lg border border-border bg-white p-2">
        <p className="mb-1 text-theme-xs font-medium text-gray-500">Preview, as it prints</p>
        <ChartPreview chart={chart} />
      </div>
      {problem ? <p className="text-theme-xs text-error-600" role="alert">{problem}</p> : null}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>Back</Button>
        <Button disabled={!!problem} onClick={() => onDone({ ...g, title: g.title.trim() })}>Keep graph</Button>
      </div>
    </section>
  );
}
