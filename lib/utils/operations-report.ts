// The Report generator's document (Reports > Generate, Nov 2026): the programs (the Programs
// report's lines), donations, transport, staff hours, NCH billing and inventory figures for a range,
// each with the previous range beside it, as one ReportSpec and one AnalysisInput. Pure.

import type { AnalysisInput, AnalysisSection } from "../ai/report-analysis.ts";
import type { ReportChart, ReportSection, ReportSpec } from "../pdf/report-doc.ts";
import { IMPACT_GROUPS, cell, changeLabel, shown, total, type Bucket, type ImpactRow } from "./program-impact.ts";
import { EXTRA_MEASURES, PROGRAM_SECTION, resolveGraph, scorecardOf, yearShare, type GraphContext, type GraphDef, type GraphFigure } from "./report-graphs.ts";

export type GeneratorSectionKey = "headline" | "housing" | "occupancy" | "transportation" | "meals" | "care_cart" | "center" | "activities" | "caf" | "donations" | "expenses" | "staff" | "inventory";

export const GENERATOR_SECTIONS: { key: GeneratorSectionKey; label: string }[] = [
  { key: "headline", label: "Headline figures" },
  { key: "housing", label: "Housing" },
  { key: "occupancy", label: "Occupancy & beds" },
  { key: "transportation", label: "Transportation" },
  { key: "meals", label: "Meals" },
  { key: "care_cart", label: "Care Cart" },
  { key: "center", label: "LAF Center @ NCH" },
  { key: "activities", label: "Activities @ LAF House" },
  { key: "caf", label: "CAF / NCH billing" },
  { key: "donations", label: "Donations" },
  { key: "expenses", label: "Expenses" },
  { key: "staff", label: "Staff hours" },
  { key: "inventory", label: "Inventory & gifts in kind" },
];

/** The headings a section key prints (for a profile's drawing). */
function headingsOf(key: GeneratorSectionKey): string[] {
  const extra: Partial<Record<GeneratorSectionKey, string[]>> = {
    transportation: ["Transport & fuel"], caf: ["NCH billing"], headline: ["Headline figures"], occupancy: ["Occupancy & beds"],
    expenses: ["Expenses", "Expenses by account", "Expenses by fund"], donations: ["Donations"], staff: ["Staff hours"], inventory: ["Inventory & gifts in kind"],
  };
  return [...(GROUP_OF[key] ? [GROUP_OF[key]!] : []), ...(extra[key] ?? [])];
}

/** Which Programs group each section key prints. */
const GROUP_OF: Partial<Record<GeneratorSectionKey, string>> = { housing: "Housing", transportation: "Transportation", meals: "Meals @ LAF House", care_cart: "Care Cart", center: "LAF Center @ NCH", activities: "Activities @ LAF House", caf: "CAF" };

/** A simple figure with its previous value. */
export interface Figure {
  /** The figure's fixed id (report-graphs.ts), by which a profile's graphs pick it. */
  id?: string;
  label: string;
  value: number;
  previous: number;
  /** "PHP" prints as money. */
  unit?: "PHP" | "km" | "L" | "h" | "";
  /** The year to date (1 January of the period's year to the period's end). */
  ytd?: number;
  /** The year's goal for this figure (Executive › Goals), set against the year to date. */
  goal?: number;
  /** A sum of other figures or a goal's row: left out of the chart. */
  derived?: boolean;
  /** A part of the figure before it (e.g. gifts in kind: food): in the boxes and the table, not in the chart. */
  part?: boolean;
  /** Going up is bad news (spending, late arrivals): the variance reads red. */
  lowerIsBetter?: boolean;
}

/** How a profile draws a section (0150, 0152): its own graph (a scorecard when totals, over time when by columns),
 * the period against the one before as bars, sideways bars, the table without a graph, or the figures only. */
export type SectionStyle = "chart" | "bars" | "rank" | "table" | "figures";
/** The comparison columns a profile shows beside the period. */
export type ComparisonKey = "previous" | "ytd" | "goal";

export interface GeneratorExtras {
  headline?: { figures: Figure[] };
  occupancy?: { figures: Figure[]; note: string };
  expenses?: { figures: Figure[]; byAccount: { label: string; amount: number }[]; byFund: { label: string; amount: number }[]; note: string };
  transport?: { figures: Figure[]; rows: { label: string; trips: number; km: number; fuel: number }[] };
  caf?: { figures: Figure[]; rows: { label: string; billed: number; paid: number; absorbed: number }[] };
  donations?: { figures: Figure[]; rows: { label: string; cash: number; food: number; nonFood: number }[] };
  staff?: { figures: Figure[]; rows: { label: string; hours: number; late: number }[] };
  inventory?: { figures: Figure[]; rows: { label: string; food: number; nonFood: number }[] };
}

const num = (n: number) => (Number.isInteger(n) ? n.toLocaleString("en-US") : n.toLocaleString("en-US", { maximumFractionDigits: 1 }));
const fmt = (f: Figure, v: number) => (f.unit === "PHP" ? `PHP ${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : f.unit ? `${num(v)} ${f.unit}` : num(v));

const round2 = (n: number) => Math.round(n * 100) / 100;
/** "+160 (+25%)": the variance as an amount and a percent. */
function variance(f: Figure): string {
  const d = round2(f.value - f.previous);
  const pct = changeLabel(f.value, f.previous);
  return d === 0 && !pct ? "" : `${d > 0 ? "+" : ""}${num(d)}${pct ? ` (${pct})` : ""}`;
}
// The boxes keep the short percent (the PDF's boxes are narrow); the table carries the amount.
function figureKpis(figures: Figure[]) {
  return figures.filter((f) => !f.derived).map((f) => ({ label: f.label, value: fmt(f, f.value), previous: fmt(f, f.previous), change: changeLabel(f.value, f.previous) }));
}
/** The comparison table of a section shown as totals: each figure for the period, the one before, the variance, the
 * year to date, and the year's goal where there is one. */
function comparison(figures: Figure[], period: string, previousPeriod: string, ytdLabel: string, goalYear: number, show: ReadonlySet<ComparisonKey>) {
  const prev = show.has("previous");
  const ytd = show.has("ytd");
  const goals = show.has("goal") && figures.some((f) => f.goal != null);
  return {
    // Few columns, so the first keeps room for long names on paper: the variance and the goal each in one.
    columns: ["Figure", period, ...(prev ? [previousPeriod, "Variance"] : []), ...(ytd ? [ytdLabel] : []), ...(goals ? [`Goal ${goalYear}`] : [])],
    rows: figures.map((f) => [
      f.unit === "PHP" ? `${f.label} (PHP)` : f.unit ? `${f.label} (${f.unit})` : f.label,
      round2(f.value),
      ...(prev ? [round2(f.previous), variance(f) || "—"] : []),
      ...(ytd ? [f.ytd == null ? "—" : round2(f.ytd)] : []),
      ...(goals ? [f.goal ? `${num(round2(f.goal))} (${Math.round(((f.ytd ?? 0) / f.goal) * 100)}%)` : "—"] : []),
    ]),
  };
}
function figureInput(figures: Figure[]) {
  return figures.map((f) => ({ label: f.unit === "PHP" ? `${f.label} (PHP)` : f.label, value: f.value, previous: f.previous }));
}

export function operationsReport(args: {
  sections: GeneratorSectionKey[];
  rows: readonly ImpactRow[];
  previous: readonly ImpactRow[];
  buckets: readonly Bucket[];
  extras: GeneratorExtras;
  period: string;
  previousPeriod: string;
  /** Totals only (one comparison table a section) instead of the columns by day, week or month. */
  totalsOnly?: boolean;
  /** The programs' rows from 1 January to the day before the period (the period's own figure is added to them, so
   * a period never exceeds its year to date), the label ("YTD 2026") and the year. */
  ytdRows?: readonly ImpactRow[];
  ytdLabel?: string;
  goalYear?: number;
  /** The year's goals by Programs group ("Housing", "Meals @ LAF House" …): the lines the goal counts and its target. */
  goals?: Record<string, { label: string; lines: string[]; target: number }>;
  /** A profile's drawing per section, and its comparison columns (all three when not given). */
  styles?: Partial<Record<GeneratorSectionKey, SectionStyle>>;
  comparisons?: readonly ComparisonKey[];
  /** A note under a section's description (e.g. how many nights came from the House Sheet). */
  notes?: Partial<Record<string, string>>;
  /** The report's title (a profile's name) and its subtitle (the profile's description). */
  title?: string;
  subtitle?: string;
  /** The profile's own graphs (0152), the year to date's last day (the goals' pace, the months January to now), the
   * period's first day and grain, and the months January to now of the figures that aren't Programs lines. */
  graphs?: readonly GraphDef[];
  ytdEnd?: string;
  windowFrom?: string;
  grain?: "day" | "week" | "month";
  monthly?: Readonly<Record<string, number[]>>;
}): { spec: ReportSpec; input: AnalysisInput; context: GraphContext } {
  const { sections, rows, previous, buckets, extras, period, previousPeriod, totalsOnly = false, ytdRows = [], ytdLabel = "Year to date", goalYear = 0, goals = {} } = args;
  const columnsShown = new Set<ComparisonKey>(args.comparisons ?? ["previous", "ytd", "goal"]);
  const compare = (figures: Figure[]) => comparison(figures, period, previousPeriod, ytdLabel, goalYear, columnsShown);
  const title = args.title || "Operations Report";
  const withNote = (heading: string, description: string) => (args.notes?.[heading] ? `${description} ${args.notes[heading]}` : description);
  // One scale a chart: the figures in the first one's unit, without sums and goal rows.
  const twoBars = (figures: Figure[]) => ({ kind: "bar" as const, labels: [previousPeriod, period], series: figures.filter((f) => !f.derived && !f.part && (f.unit ?? "") === (figures[0]?.unit ?? "")).map((f) => ({ label: f.label, values: [f.previous, f.value] })) });
  const ytdOf = (key: Parameters<typeof total>[1]) => total(ytdRows, key) + total(rows, key);
  // A goal counts as Executive › Goals counts it (the app's figure, else the sheet's).
  const asGoals = (rs: readonly ImpactRow[], lines: readonly string[]) => rs.filter((r) => lines.includes(r.line)).reduce((s, r) => s + (r.native || r.fromSheet), 0);
  const out: ReportSection[] = [];
  const inputs: AnalysisSection[] = [];
  // The graphs' side: the pace of the year, the months January to now, every figure by its id.
  const pace = args.ytdEnd ? yearShare(args.ytdEnd) : undefined;
  const monthCount = args.ytdEnd ? Number(args.ytdEnd.slice(5, 7)) : 0;
  const monthLabels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].slice(0, monthCount);
  const linesMonths = (lines: readonly string[]) => {
    const m: number[] = Array.from({ length: monthCount }, () => 0);
    const add = (r: ImpactRow, key: string) => {
      const i = Number(key.slice(5, 7)) - 1;
      if (lines.includes(r.line) && i >= 0 && i < monthCount) m[i]! += shown(r);
    };
    ytdRows.forEach((r) => add(r, r.bucket));
    // A week's key is its Monday, which may sit in the month before the period: it counts in the period's month.
    rows.forEach((r) => add(r, args.windowFrom && r.bucket < args.windowFrom ? args.windowFrom : r.bucket));
    return m;
  };
  const linesSeries = (lines: readonly string[]) => buckets.map((b) => rows.filter((r) => r.bucket === b.key && lines.includes(r.line)).reduce((s, r) => s + shown(r), 0));
  const figMap = new Map<string, GraphFigure>();
  const register = (f: Figure, opts: { lines?: readonly string[]; rows?: Record<string, string | number>[] } = {}) => {
    if (!f.id) return;
    const meta = EXTRA_MEASURES[f.id];
    const lines = opts.lines ?? meta?.lines;
    const series = lines ? linesSeries(lines) : meta?.row && opts.rows ? opts.rows.map((r) => meta.row!.reduce((s, k) => s + Number(r[k] ?? 0), 0)) : undefined;
    figMap.set(f.id, { ...f, id: f.id, lowerIsBetter: f.lowerIsBetter ?? meta?.lowerIsBetter, series, months: lines ? linesMonths(lines) : args.monthly?.[f.id] });
  };
  const scoreCtx = { period, previousPeriod, comparisons: columnsShown, pace };
  // The period against the one before as bars: what "bars" (and sideways bars) draws instead of the scorecard.
  const alt = new Map<string, ReportChart>();
  const program = (groupName: string) => {
    const g = IMPACT_GROUPS.find((x) => x.group === groupName)!;
    // The lines in the first line's unit (people, not volunteers or hours): the chart and the Total row add only these.
    const same = g.lines.filter((l) => l.unit === g.lines[0]!.unit);
    const figures: Figure[] = g.lines.map((l) => ({ id: `${PROGRAM_SECTION[g.group]}.${l.key}`, label: `${l.label} (${l.unit})`, value: total(rows, l.key), previous: total(previous, l.key), ytd: ytdOf(l.key) }));
    figures.forEach((f, i) => register(f, { lines: [g.lines[i]!.key] }));
    // The year's goal counts some of the group's lines together: its own row, against the year to date.
    const goal = goals[g.group];
    const sumOf = (rs: readonly ImpactRow[]) => (goal ? asGoals(rs, goal.lines) : 0);
    const compared: Figure[] = goal ? [...figures, { label: `Goal: ${goal.label}`, value: sumOf(rows), previous: sumOf(previous), ytd: sumOf(ytdRows) + sumOf(rows), goal: goal.target, derived: true }] : figures;
    const withYtd = columnsShown.has("ytd");
    const tableRows = g.lines.map((l) => [l.label, ...buckets.map((b) => shown(cell(rows, l.key, b.key))), total(rows, l.key), ...(withYtd ? [ytdOf(l.key)] : [])]);
    out.push({
      heading: g.group,
      description: withNote(g.group, g.description),
      kpis: figureKpis(figures),
      table: totalsOnly
        ? compare(compared)
        : { columns: ["Line", ...buckets.map((b) => b.label), "Total", ...(withYtd ? [ytdLabel] : [])], rows: tableRows, totals: same.length > 1 ? [same.length < g.lines.length ? `Total (${g.lines[0]!.unit})` : "Total", ...buckets.map((b) => same.reduce((s, l) => s + shown(cell(rows, l.key, b.key)), 0)), same.reduce((s, l) => s + total(rows, l.key), 0), ...(withYtd ? [same.reduce((s, l) => s + ytdOf(l.key), 0)] : [])] : undefined },
      chart: totalsOnly
        ? scorecardOf(compared, scoreCtx)
        : { kind: g.lines.length > 1 ? "stacked" : "bar", labels: buckets.map((b) => b.label), series: same.map((l) => ({ label: l.label, values: buckets.map((b) => shown(cell(rows, l.key, b.key))) })) },
    });
    alt.set(g.group, twoBars(figures.filter((_, i) => same.includes(g.lines[i]!))));
    inputs.push({ heading: g.group, description: g.description, kpis: figureInput(figures) });
  };
  // A section of figures only (no columns by period): the comparison table, the two-bar chart, and any table of its own.
  const figuresSection = (heading: string, description: string, figures: Figure[]) => {
    figures.forEach((f) => register(f));
    out.push({ heading, description, kpis: figureKpis(figures), table: compare(figures), chart: scorecardOf(figures, scoreCtx) });
    alt.set(heading, twoBars(figures));
    inputs.push({ heading, description, kpis: figureInput(figures) });
  };
  const extra = (heading: string, description: string, x: { figures: Figure[]; rows: Record<string, string | number>[] } | undefined, columns: string[], keys: string[], chart: { kind: "bar" | "stacked"; series: { label: string; key: string }[] }) => {
    if (!x) return;
    x.figures.forEach((f) => register(f, { rows: x.rows }));
    alt.set(heading, twoBars(x.figures));
    out.push({
      heading,
      description,
      kpis: figureKpis(x.figures),
      table: totalsOnly ? compare(x.figures) : { columns, rows: x.rows.map((r) => keys.map((k) => r[k] ?? "")), totals: ["Total", ...keys.slice(1).map((k) => x.rows.reduce((s, r) => s + Number(r[k] ?? 0), 0))] },
      chart: totalsOnly ? scorecardOf(x.figures, scoreCtx) : { kind: chart.kind, labels: x.rows.map((r) => String(r.label)), series: chart.series.map((s) => ({ label: s.label, values: x.rows.map((r) => Number(r[s.key] ?? 0)) })) },
    });
    inputs.push({ heading, description, kpis: figureInput(x.figures) });
  };

  for (const key of sections) {
    const group = GROUP_OF[key];
    if (group) {
      program(group);
      if (key === "transportation") extra("Transport & fuel", "Trips driven, kilometres from the odometer readings and pesos spent on fuel, from Transport.", extras.transport, ["Period", "Trips", "Km", "Fuel (PHP)"], ["label", "trips", "km", "fuel"], { kind: "bar", series: [{ label: "Trips", key: "trips" }] });
      if (key === "caf") extra("NCH billing", "The NCH Cancer Assistance Fund bills: pesos billed and paid, and the nights above the monthly cap that LAF absorbed.", extras.caf, ["Month", "Billed (PHP)", "Paid (PHP)", "Nights absorbed"], ["label", "billed", "paid", "absorbed"], { kind: "bar", series: [{ label: "Billed", key: "billed" }, { label: "Paid", key: "paid" }] });
      continue;
    }
    if (key === "donations") extra("Donations", "Cash gifts in pesos from the Donation Tracker and gifts in kind by the category each line was received under in LAF Inventory.", extras.donations, ["Period", "Cash (PHP)", "Food (PHP)", "Non-food (PHP)"], ["label", "cash", "food", "nonFood"], { kind: "stacked", series: [{ label: "Cash", key: "cash" }, { label: "Food", key: "food" }, { label: "Non-food", key: "nonFood" }] });
    if (key === "staff") extra("Staff hours", "Hours worked and late arrivals from the staff's clock-ins and clock-outs.", extras.staff, ["Period", "Hours", "Late arrivals"], ["label", "hours", "late"], { kind: "bar", series: [{ label: "Hours", key: "hours" }] });
    if (key === "headline" && extras.headline) figuresSection("Headline figures", "The foundation's main figures for the period, counted as the dashboard counts them.", extras.headline.figures);
    if (key === "occupancy" && extras.occupancy) figuresSection("Occupancy & beds", extras.occupancy.note, extras.occupancy.figures);
    if (key === "expenses" && extras.expenses) {
      const x = extras.expenses;
      figuresSection("Expenses", x.note, x.figures);
      if (x.byAccount.length)
        out.push({
          heading: "Expenses by account",
          description: "The same paid vouchers by the account each line was charged to.",
          table: { columns: ["Account", "Amount (PHP)"], rows: x.byAccount.map((a) => [a.label, round2(a.amount)]), totals: ["Total", round2(x.byAccount.reduce((t, a) => t + a.amount, 0))] },
          chart: { kind: "rank", labels: x.byAccount.slice(0, 10).map((a) => a.label), series: [{ label: "Paid (PHP)", values: x.byAccount.slice(0, 10).map((a) => a.amount) }] },
        });
      if (x.byFund.length > 1) out.push({ heading: "Expenses by fund", description: "The same paid vouchers by the fund they were paid from.", table: { columns: ["Fund", "Amount (PHP)"], rows: x.byFund.map((a) => [a.label, round2(a.amount)]) }, chart: { kind: "rank", labels: x.byFund.map((a) => a.label), series: [{ label: "Paid (PHP)", values: x.byFund.map((a) => a.amount) }] } });
    }
    if (key === "inventory") extra("Inventory & gifts in kind", "Value of the goods received in LAF Inventory in the range, food and non-food, at the values on the receipts.", extras.inventory, ["Period", "Food (PHP)", "Non-food (PHP)"], ["label", "food", "nonFood"], { kind: "stacked", series: [{ label: "Food", key: "food" }, { label: "Non-food", key: "nonFood" }] });
  }
  // A profile's drawing: sideways bars, the table without a chart, or the figures only.
  const styleOf = (heading: string) => {
    const key = sections.find((k) => headingsOf(k).includes(heading));
    return key ? args.styles?.[key] : undefined;
  };
  const styled = out.map((sec): ReportSection => {
    const st = styleOf(sec.heading);
    if (st === "figures") return { ...sec, table: undefined, chart: undefined };
    if (st === "table") return { ...sec, chart: undefined };
    if (st === "bars") return { ...sec, chart: alt.get(sec.heading) ?? sec.chart };
    if (st === "rank") {
      const c = sec.chart?.kind === "scorecard" ? alt.get(sec.heading) : sec.chart;
      return { ...sec, chart: c && c.series.length === 1 ? { ...c, kind: "rank" } : c };
    }
    return sec;
  });
  // The profile's graphs, each after its section's figures (or at the top, or when its section isn't in the report).
  const ctx: GraphContext = {
    figures: figMap,
    sets: new Map(extras.expenses && sections.includes("expenses") ? [["expenses.by_account", extras.expenses.byAccount], ["expenses.by_fund", extras.expenses.byFund]] : []),
    period, previousPeriod, ytdLabel, goalYear,
    bucketLabels: buckets.map((b) => b.label),
    monthLabels,
    perYear: args.grain === "day" ? 365 : args.grain === "week" ? 52 : 12,
    comparisons: columnsShown,
    pace,
  };
  const top: ReportChart[] = [];
  for (const g of args.graphs ?? []) {
    if (g.hidden) continue;
    const chart = resolveGraph(g, ctx);
    const home = g.place === "top" ? undefined : styled.find((s) => headingsOf(g.place as GeneratorSectionKey).includes(s.heading));
    if (home) home.graphs = [...(home.graphs ?? []), chart];
    else top.push(chart);
  }
  const placed: ReportSection[] = top.length ? [{ heading: "At a glance", graphs: top }, ...styled] : styled;
  return {
    spec: { title, subtitle: args.subtitle?.trim() || "The foundation's programs and operations for the period, from the app's records", period, previousPeriod, sections: placed },
    input: { title, period, previousPeriod, sections: inputs },
    // The figures the graphs drew from, for the graph builder's preview.
    context: ctx,
  };
}
