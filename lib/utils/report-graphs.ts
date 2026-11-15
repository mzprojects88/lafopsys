// Report graphs (Nov 2026, 0152): the figures a report knows by a fixed id, the graphs a profile saves (type, figures,
// how they're shown, where they print), the rules of which type fits which data, and the drawing each one becomes.
// Pure and browser-safe: the report, the PDF and the graph builder's preview use the same functions.
import type { ChartKind, ChartRow, ReportChart } from "../pdf/charts.ts";
import { IMPACT_GROUPS, changeLabel } from "./program-impact.ts";
import type { Figure, GeneratorSectionKey } from "./operations-report.ts";

type Unit = Figure["unit"];
/** A figure's fixed facts: what section it belongs to, its name, unit, and how to read it over time. */
export interface MeasureMeta {
  section: GeneratorSectionKey;
  label: string;
  unit?: Unit;
  /** A part of the figure before it (gifts in kind: food): in the boxes and the table, not the section's own chart. */
  part?: boolean;
  /** Going up is bad news (spending, late arrivals). */
  lowerIsBetter?: boolean;
  /** The Programs lines it adds up (its days, weeks and months come from them). */
  lines?: string[];
  /** The column(s) of its section's rows that give it by day, week or month. */
  row?: string[];
}

/** The figures outside the Programs lines, by id ("donations.cash"). The report labels its figures from here. */
export const EXTRA_MEASURES: Record<string, MeasureMeta> = {
  "headline.bed_nights": { section: "headline", label: "Bed nights provided", lines: ["housing"] },
  "headline.rides": { section: "headline", label: "Patient and caregiver rides", lines: ["transport_to_nch", "transport_to_laf"] },
  "headline.meals": { section: "headline", label: "Meals served", lines: ["meals_breakfast", "meals_lunch", "meals_dinner"] },
  "headline.child_visits": { section: "headline", label: "Child visits (Activity Center @ NCH)", lines: ["center_nch_participants"] },
  "headline.care_cart": { section: "headline", label: "Care Cart meals (served at NCH)", lines: ["care_cart_1000", "care_cart_1200", "care_cart_1700"] },
  "headline.patients": { section: "headline", label: "Unique patients admitted" },
  "headline.cash": { section: "headline", label: "Cash donations", unit: "PHP" },
  "headline.expenses": { section: "headline", label: "Expenses (paid vouchers)", unit: "PHP", lowerIsBetter: true },
  "occupancy.families": { section: "occupancy", label: "Families a night (average)" },
  "occupancy.beds_pct": { section: "occupancy", label: "Beds in use (average, %)" },
  "occupancy.family_nights": { section: "occupancy", label: "Family-nights" },
  "occupancy.empty_nights": { section: "occupancy", label: "Nights with nobody in", lowerIsBetter: true },
  "expenses.paid": { section: "expenses", label: "Paid", unit: "PHP", lowerIsBetter: true },
  "expenses.budget": { section: "expenses", label: "Approved budget for these days", unit: "PHP" },
  "expenses.vouchers": { section: "expenses", label: "Vouchers paid" },
  "expenses.per_night": { section: "expenses", label: "Spending per bed night", unit: "PHP", lowerIsBetter: true },
  "transportation.trips": { section: "transportation", label: "Trips", row: ["trips"] },
  "transportation.km": { section: "transportation", label: "Kilometres", unit: "km", row: ["km"] },
  "transportation.fuel": { section: "transportation", label: "Fuel spent", unit: "PHP", lowerIsBetter: true, row: ["fuel"] },
  // NCH billing's rows are months, not the period's days or weeks: no "over the period" for it.
  "caf.billed": { section: "caf", label: "Billed", unit: "PHP" },
  "caf.paid": { section: "caf", label: "Paid", unit: "PHP" },
  "caf.absorbed": { section: "caf", label: "Nights absorbed", lowerIsBetter: true },
  "donations.cash": { section: "donations", label: "Cash gifts", unit: "PHP", row: ["cash"] },
  "donations.gik": { section: "donations", label: "Gifts in kind", unit: "PHP", row: ["food", "nonFood"] },
  "donations.gik_food": { section: "donations", label: "Gifts in kind: food", unit: "PHP", part: true, row: ["food"] },
  "donations.gik_nonfood": { section: "donations", label: "Gifts in kind: non-food", unit: "PHP", part: true, row: ["nonFood"] },
  "donations.cash_count": { section: "donations", label: "Cash gifts (count)" },
  "donations.gik_count": { section: "donations", label: "Gifts in kind (count)" },
  "staff.hours": { section: "staff", label: "Hours worked", unit: "h", row: ["hours"] },
  "staff.late": { section: "staff", label: "Late arrivals", lowerIsBetter: true, row: ["late"] },
  "inventory.food": { section: "inventory", label: "Food received", unit: "PHP", row: ["food"] },
  "inventory.nonfood": { section: "inventory", label: "Non-food received", unit: "PHP", row: ["nonFood"] },
};

/** Breakdowns that are a list in themselves (each account, each fund): shown alone, as shares or ranked bars. */
export const SET_MEASURES: Record<string, { section: GeneratorSectionKey; label: string }> = {
  "expenses.by_account": { section: "expenses", label: "Expenses by account (each account)" },
  "expenses.by_fund": { section: "expenses", label: "Expenses by fund (each fund)" },
};

/** Which section key prints each Programs group. */
export const PROGRAM_SECTION: Record<string, GeneratorSectionKey> = { Housing: "housing", Transportation: "transportation", "Meals @ LAF House": "meals", "Care Cart": "care_cart", "LAF Center @ NCH": "center", "Activities @ LAF House": "activities", CAF: "caf" };

/** A Programs line's id ("meals.meals_breakfast") and its facts. */
export function programMeasure(group: string, line: { key: string; label: string; unit: string }): [string, MeasureMeta] {
  const section = PROGRAM_SECTION[group]!;
  return [`${section}.${line.key}`, { section, label: `${line.label} (${line.unit})`, lines: [line.key], unit: "" }];
}

/** Every figure a graph can use, by section, for the graph builder (the report may hold fewer: what the viewer may
 * see and what the period has). */
export function measureCatalogue(): { id: string; meta: MeasureMeta; set?: boolean; unitName: string }[] {
  const program = IMPACT_GROUPS.flatMap((g) => g.lines.map((l) => ({ ...((([id, meta]) => ({ id, meta }))(programMeasure(g.group, l))), unitName: l.unit })));
  const extra = Object.entries(EXTRA_MEASURES).map(([id, meta]) => ({ id, meta, unitName: unitName(meta.unit) }));
  const sets = Object.entries(SET_MEASURES).map(([id, s]) => ({ id, meta: { section: s.section, label: s.label, unit: "PHP" as const }, set: true, unitName: "pesos" }));
  return [...program, ...extra, ...sets];
}
function unitName(u: Unit): string {
  return u === "PHP" ? "pesos" : u === "km" ? "km" : u === "h" ? "hours" : u === "L" ? "litres" : "count";
}

export type GraphType = Exclude<ChartKind, "rank">;
export type ShowBy = "comparisons" | "over_time" | "months" | "breakdown";

/** A graph a profile saves (ops.report_profiles.graphs). */
export interface GraphDef {
  id: string;
  title: string;
  type: GraphType;
  /** Figure ids (EXTRA_MEASURES, Programs lines, or one SET_MEASURES list). */
  measures: string[];
  showBy: ShowBy;
  /** "top" (after the report's summary) or a section key (after that section's figures). */
  place: string;
  /** Kept in the profile but not printed. */
  hidden?: boolean;
  /** Values on the bars; the goal's pace as a dashed line; the current period stronger. */
  values?: boolean;
  goalLine?: boolean;
}

export const GRAPH_TYPES: { type: GraphType; label: string; hint: string }[] = [
  { type: "scorecard", label: "Scorecard", hint: "Each figure's period, year to date and goal, with the variance" },
  { type: "bar", label: "Bar", hint: "Bars side by side" },
  { type: "hbar", label: "Horizontal bar", hint: "Sideways bars, for long names" },
  { type: "stacked", label: "Stacked bar", hint: "Parts of a whole in one bar" },
  { type: "line", label: "Line", hint: "A trend over time" },
  { type: "area", label: "Area", hint: "A trend over time, filled" },
  { type: "combo", label: "Bar + line", hint: "Bars, with the last figure as a line" },
  { type: "pie", label: "Pie", hint: "Shares of a whole" },
  { type: "donut", label: "Donut", hint: "Shares of a whole, with the total" },
  { type: "gauge", label: "Gauge", hint: "The year to date as a share of the goal" },
  { type: "variance", label: "Variance", hint: "Change from the period before, green or red" },
  { type: "kpi", label: "Big numbers", hint: "Each figure large, with its change" },
];

export const SHOW_BY: { value: ShowBy; label: string }[] = [
  { value: "comparisons", label: "Period vs previous, YTD and goal" },
  { value: "over_time", label: "Over the period (days, weeks or months)" },
  { value: "months", label: "Month by month, January to now" },
  { value: "breakdown", label: "Breakdown (each figure a bar or slice)" },
];

/** What a type accepts: how it can show the figures, how many, and whether units may mix (rows have their own
 * scale; axes and slices don't). */
export function graphRules(type: GraphType): { showBy: ShowBy[]; min: number; max: number; mixedUnits: boolean; sets: boolean } {
  switch (type) {
    case "scorecard":
    case "variance":
    case "kpi":
    case "gauge":
      return { showBy: ["comparisons"], min: 1, max: 12, mixedUnits: true, sets: false };
    case "pie":
    case "donut":
      return { showBy: ["breakdown"], min: 1, max: 8, mixedUnits: false, sets: true };
    case "line":
    case "area":
      return { showBy: ["over_time", "months"], min: 1, max: 6, mixedUnits: false, sets: false };
    case "stacked":
    case "combo":
      return { showBy: ["comparisons", "over_time", "months"], min: 2, max: 8, mixedUnits: false, sets: false };
    default:
      return { showBy: ["comparisons", "over_time", "months", "breakdown"], min: 1, max: 8, mixedUnits: false, sets: true };
  }
}

/** Why a definition can't be drawn as it stands (the builder shows it and won't save), or null. */
export function graphProblem(g: GraphDef): string | null {
  const r = graphRules(g.type);
  const known = new Map(measureCatalogue().map((m) => [m.id, m]));
  const picked = g.measures.map((id) => known.get(id)).filter((m) => m != null);
  if (!g.title.trim()) return "Give the graph a title.";
  if (!r.showBy.includes(g.showBy)) return `A ${label(g.type)} graph shows ${r.showBy.map((s) => SHOW_BY.find((x) => x.value === s)!.label.toLowerCase()).join(" or ")}.`;
  const sets = picked.filter((m) => m.set);
  if (sets.length && (picked.length > 1 || !r.sets || g.showBy !== "breakdown")) return "A list such as each account goes alone, as a breakdown (bar, horizontal bar, pie or donut).";
  if (!sets.length && picked.length < r.min) return `Pick at least ${r.min} figure${r.min > 1 ? "s" : ""}.`;
  if (picked.length > r.max) return `Pick at most ${r.max} figures.`;
  if (!r.mixedUnits && new Set(picked.map((m) => m.unitName)).size > 1) return "These figures are in different units (pesos, counts, hours): one scale can't show them. Use a scorecard, variance or big numbers, or pick figures in one unit.";
  if (g.showBy === "months" && picked.some((m) => !monthsAvailable(m.id))) return "Some of these figures have no month-by-month history (headline money, occupancy, expenses, NCH billing).";
  if (g.showBy === "over_time" && picked.some((m) => !seriesAvailable(m.id))) return "Some of these figures have no day, week or month figures (headline patients and money, occupancy, expenses, NCH billing).";
  return null;
}
const label = (t: GraphType) => GRAPH_TYPES.find((x) => x.type === t)!.label.toLowerCase();

/** Figures the report has by day, week or month over the period (Programs lines and the figures with dated rows). */
export function seriesAvailable(id: string): boolean {
  const meta = EXTRA_MEASURES[id];
  if (!meta) return !SET_MEASURES[id] && !id.endsWith(".goal");
  return !!meta.lines || !!meta.row;
}

/** Figures whose months January to now the report can count (Programs lines, and the dated donations, gifts,
 * trips and hours). */
export function monthsAvailable(id: string): boolean {
  const meta = EXTRA_MEASURES[id];
  if (!meta) return !SET_MEASURES[id] && !id.endsWith(".goal");
  return !!meta.lines || ["donations.cash", "donations.gik", "donations.gik_food", "donations.gik_nonfood", "donations.cash_count", "donations.gik_count", "transportation.trips", "transportation.km", "transportation.fuel", "staff.hours", "staff.late", "inventory.food", "inventory.nonfood"].includes(id);
}

/** A figure as the graphs read it: the Figure, by bucket of the period, and by month January to now. */
export interface GraphFigure extends Figure {
  id: string;
  series?: number[];
  months?: number[];
}

/** What a report hands every graph: its figures, its lists, and how the period is labelled. */
export interface GraphContext {
  figures: Map<string, GraphFigure>;
  sets: Map<string, { label: string; amount: number }[]>;
  period: string;
  previousPeriod: string;
  ytdLabel: string;
  goalYear: number;
  bucketLabels: string[];
  monthLabels: string[];
  /** Periods in a year at the report's grain (12 months, 52 weeks, 365 days): the goal line's pace. */
  perYear: number;
  comparisons: ReadonlySet<"previous" | "ytd" | "goal">;
  pace?: number;
}

const num = (n: number) => (Number.isInteger(n) ? n.toLocaleString("en-US") : n.toLocaleString("en-US", { maximumFractionDigits: 1 }));
const money = (f: Figure, v: number) => (f.unit === "PHP" ? `PHP ${num(Math.round(v))}` : f.unit ? `${num(v)} ${f.unit}` : num(v));
const firstWord = (s: string) => s.split(/[\s(]/)[0] ?? s;

/** Good news? Up is good unless the figure is one where less is better; no change is neither. */
function goodOf(f: Figure & { lowerIsBetter?: boolean }): boolean | null {
  if (f.value === f.previous) return null;
  return (f.value > f.previous) !== !!f.lowerIsBetter;
}

/** A scorecard row: the period's figure and its variance, then the year to date against the goal. */
export function scoreRow(f: Figure & { lowerIsBetter?: boolean }, ctx: Pick<GraphContext, "period" | "previousPeriod" | "comparisons">): ChartRow {
  const prev = ctx.comparisons.has("previous");
  const ytd = ctx.comparisons.has("ytd") && f.ytd != null ? f.ytd : undefined;
  const goal = ctx.comparisons.has("goal") && f.goal ? f.goal : undefined;
  const change = prev ? changeLabel(f.value, f.previous) : "";
  const subParts = [
    ytd != null ? `YTD ${money(f, ytd)}` : "",
    goal ? `of goal ${money(f, goal)} (${Math.round(((ytd ?? f.value) / goal) * 100)}%)` : ytd != null ? "no goal set" : "",
    prev && ytd == null ? `${firstWord(ctx.previousPeriod)} ${money(f, f.previous)}` : "",
  ].filter(Boolean);
  return {
    label: f.unit === "PHP" ? `${f.label} (PHP)` : f.label,
    value: f.value,
    ytd,
    goal,
    previous: prev ? f.previous : undefined,
    text: `${firstWord(ctx.period)} ${money(f, f.value)}${change ? `   ${change} vs ${firstWord(ctx.previousPeriod)}` : ""}`,
    sub: subParts.join(" "),
    good: prev ? goodOf(f) : null,
  };
}

/** A section's own graph in a totals report: its figures as a scorecard. */
export function scorecardOf(figures: (Figure & { lowerIsBetter?: boolean })[], ctx: Pick<GraphContext, "period" | "previousPeriod" | "comparisons" | "pace">): ReportChart | undefined {
  // Parts (gifts in kind: food) get their own rows: each row has its own scale, nothing is added twice.
  const rows = figures.map((f) => scoreRow(f, ctx));
  return rows.length ? { kind: "scorecard", labels: [], series: [], rows, pace: ctx.pace } : undefined;
}

/** The share of the year gone at the end of a day ("2026-11-30" -> 0.997): the pace a goal should be at. */
export function yearShare(iso: string): number {
  const y = Number(iso.slice(0, 4));
  const start = Date.UTC(y, 0, 1);
  return Math.min(1, Math.max(0, (Date.parse(`${iso}T00:00:00Z`) + 86_400_000 - start) / (Date.UTC(y + 1, 0, 1) - start)));
}

/** A saved graph drawn from the report's figures. Figures the report doesn't hold (not in it, or not the viewer's to
 * see) are left out and named in the note; a graph left with nothing says so. */
export function resolveGraph(g: GraphDef, ctx: GraphContext): ReportChart {
  const base = { title: g.title, labels: [] as string[], series: [] as ReportChart["series"] };
  const missing = g.measures.filter((id) => !ctx.figures.has(id) && !ctx.sets.has(id));
  const figs = g.measures.map((id) => ctx.figures.get(id)).filter((f): f is GraphFigure => !!f);
  const missingNote = missing.length ? `Not in this report: ${missing.map((id) => EXTRA_MEASURES[id]?.label ?? SET_MEASURES[id]?.label ?? id).join(", ")}.` : undefined;
  const empty = (why: string): ReportChart => ({ ...base, kind: "kpi", rows: [], note: why });
  const problem = graphProblem(g);
  if (problem && !problem.startsWith("Some of these")) return empty(problem);

  if (g.type === "scorecard" || g.type === "variance" || g.type === "kpi" || g.type === "gauge") {
    if (!figs.length) return empty(missingNote ?? "No figures to show.");
    const rows = figs.map((f): ChartRow => {
      const r = scoreRow(f, ctx);
      if (g.type === "variance") {
        const pct = f.previous ? Math.round(((f.value - f.previous) / Math.abs(f.previous)) * 1000) / 10 : 0;
        return { label: r.label, value: pct, text: changeLabel(f.value, f.previous) || "no change", good: goodOf(f) };
      }
      if (g.type === "kpi") return { label: f.label, value: f.value, text: money(f, f.value), sub: ctx.comparisons.has("previous") ? `${changeLabel(f.value, f.previous) || "no change"} vs ${firstWord(ctx.previousPeriod)}` : "", good: ctx.comparisons.has("previous") ? goodOf(f) : null };
      if (g.type === "gauge") {
        const reached = f.ytd ?? f.value;
        return { label: f.label, value: reached, goal: f.goal || undefined, text: f.goal ? `${money(f, reached)} of ${money(f, f.goal)}` : "no goal set", sub: f.goal ? ctx.ytdLabel : "", good: f.goal ? !f.lowerIsBetter || reached <= f.goal : null };
      }
      return r;
    });
    return { ...base, kind: g.type, rows, pace: ctx.pace, note: missingNote };
  }

  // One list (each account, each fund) as a breakdown.
  const setId = g.measures.find((id) => ctx.sets.has(id));
  if (setId) {
    const list = ctx.sets.get(setId)!.slice(0, g.type === "pie" || g.type === "donut" ? 8 : 15);
    return { ...base, kind: g.type, labels: list.map((x) => x.label), series: [{ label: `${ctx.period} (PHP)`, values: list.map((x) => x.amount) }], values: g.values ?? true };
  }
  if (!figs.length) return empty(missingNote ?? "No figures to show.");
  // One scale: the figures in the first one's unit.
  const unit = figs[0]!.unit ?? "";
  const same = figs.filter((f) => (f.unit ?? "") === unit);
  const dropped = figs.filter((f) => !same.includes(f)).map((f) => f.label);
  const notes = [missingNote, dropped.length ? `Left out (another unit): ${dropped.join(", ")}.` : ""].filter(Boolean);
  const named = (f: GraphFigure) => (unit === "PHP" ? `${f.label} (PHP)` : f.label);
  const goalOf = (f: GraphFigure) => (ctx.comparisons.has("goal") ? f.goal : undefined);
  const withGoal = same.find((f) => goalOf(f));
  let chart: ReportChart;
  if (g.showBy === "breakdown") {
    chart = { ...base, kind: g.type, labels: same.map(named), series: [{ label: ctx.period, values: same.map((f) => f.value) }] };
  } else if (g.showBy === "comparisons") {
    const cols: { label: string; of: (f: GraphFigure) => number }[] = [
      ...(ctx.comparisons.has("previous") ? [{ label: ctx.previousPeriod, of: (f: GraphFigure) => f.previous }] : []),
      { label: ctx.period, of: (f: GraphFigure) => f.value },
      ...(ctx.comparisons.has("ytd") ? [{ label: ctx.ytdLabel, of: (f: GraphFigure) => f.ytd ?? 0 }] : []),
      ...(withGoal ? [{ label: `Goal ${ctx.goalYear}`, of: (f: GraphFigure) => goalOf(f) ?? 0 }] : []),
    ];
    chart = { ...base, kind: g.type, labels: cols.map((c) => c.label), series: same.map((f) => ({ label: named(f), values: cols.map((c) => c.of(f)) })), highlight: cols.findIndex((c) => c.label === ctx.period) };
  } else {
    const months = g.showBy === "months";
    const usable = same.filter((f) => (months ? f.months : f.series));
    const lacking = same.filter((f) => !usable.includes(f)).map((f) => f.label);
    if (lacking.length) notes.push(`No ${months ? "month-by-month" : "day, week or month"} figures for: ${lacking.join(", ")}.`);
    if (!usable.length) return empty(notes.join(" ") || "No figures to show.");
    const labels = months ? ctx.monthLabels : ctx.bucketLabels;
    const pace = withGoal && g.goalLine ? goalOf(withGoal)! / (months ? 12 : ctx.perYear) : 0;
    chart = {
      ...base,
      kind: g.type,
      labels,
      series: usable.map((f) => ({ label: named(f), values: labels.map((_, i) => (months ? f.months! : f.series!)[i] ?? 0) })),
      highlight: months ? labels.length - 1 : undefined,
      reference: pace > 0 ? { value: pace, label: `pace to the ${ctx.goalYear} goal: ${num(Math.round(pace))}` } : undefined,
    };
  }
  return { ...chart, values: g.values ?? true, note: notes.join(" ") || undefined };
}

/** A new profile's graphs (a profile always starts with some; hiding is the way to keep one out): its first
 * section's figures as a scorecard and as the variance from the period before. */
export function defaultGraphs(sections: string[]): GraphDef[] {
  const first = sections[0];
  const ids = measureCatalogue().filter((m) => m.meta.section === first && !m.set && !m.meta.part).map((m) => m.id).slice(0, 8);
  if (!ids.length) return [];
  return [
    { id: "g1", title: "At a glance: the period, the year to date and the goals", type: "scorecard", measures: ids, showBy: "comparisons", place: "top" },
    { id: "g2", title: "Change from the period before", type: "variance", measures: ids, showBy: "comparisons", place: "top" },
  ];
}

/** Repeatable sample figures, for a preview before the report's own figures load. */
export function sampleFigure(id: string, buckets: number, months: number): GraphFigure {
  const meta = EXTRA_MEASURES[id] ?? measureCatalogue().find((m) => m.id === id)?.meta;
  let seed = [...id].reduce((s, ch) => (s * 31 + ch.charCodeAt(0)) % 2147483647, 7);
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const scale = meta?.unit === "PHP" ? 50_000 : 400;
  const at = () => Math.round(scale * (0.6 + rand() * 0.8));
  const value = at();
  return { id, label: meta?.label ?? id, unit: meta?.unit, lowerIsBetter: meta?.lowerIsBetter, value, previous: at(), ytd: value * 10, series: Array.from({ length: buckets }, () => Math.round(value / Math.max(1, buckets) * (0.6 + rand() * 0.8))), months: Array.from({ length: months }, at) } as GraphFigure;
}
