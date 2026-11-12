// The Report generator's document (Reports > Generate, Nov 2026): the programs (the Programs
// report's lines), donations, transport, staff hours, NCH billing and inventory figures for a range,
// each with the previous range beside it, as one ReportSpec and one AnalysisInput. Pure.

import type { AnalysisInput, AnalysisSection } from "../ai/report-analysis.ts";
import type { ReportSection, ReportSpec } from "../pdf/report-doc.ts";
import { IMPACT_GROUPS, cell, changeLabel, shown, total, type Bucket, type ImpactRow } from "./program-impact.ts";

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
    expenses: ["Expenses", "Expenses by fund"], donations: ["Donations"], staff: ["Staff hours"], inventory: ["Inventory & gifts in kind"],
  };
  return [...(GROUP_OF[key] ? [GROUP_OF[key]!] : []), ...(extra[key] ?? [])];
}

/** Which Programs group each section key prints. */
const GROUP_OF: Partial<Record<GeneratorSectionKey, string>> = { housing: "Housing", transportation: "Transportation", meals: "Meals @ LAF House", care_cart: "Care Cart", center: "LAF Center @ NCH", activities: "Activities @ LAF House", caf: "CAF" };

/** A simple figure with its previous value. */
export interface Figure {
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
}

/** How a profile draws a section (0150): the chart, sideways bars, the table without a chart, or the figures only. */
export type SectionStyle = "chart" | "rank" | "table" | "figures";
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
  /** The report's title (a profile's name). */
  title?: string;
}): { spec: ReportSpec; input: AnalysisInput } {
  const { sections, rows, previous, buckets, extras, period, previousPeriod, totalsOnly = false, ytdRows = [], ytdLabel = "Year to date", goalYear = 0, goals = {} } = args;
  const columnsShown = new Set<ComparisonKey>(args.comparisons ?? ["previous", "ytd", "goal"]);
  const compare = (figures: Figure[]) => comparison(figures, period, previousPeriod, ytdLabel, goalYear, columnsShown);
  const title = args.title || "Operations Report";
  const withNote = (heading: string, description: string) => (args.notes?.[heading] ? `${description} ${args.notes[heading]}` : description);
  // One scale a chart: the figures in the first one's unit, without sums and goal rows.
  const twoBars = (figures: Figure[]) => ({ kind: "bar" as const, labels: [previousPeriod, period], series: figures.filter((f) => !f.derived && (f.unit ?? "") === (figures[0]?.unit ?? "")).map((f) => ({ label: f.label, values: [f.previous, f.value] })) });
  const ytdOf = (key: Parameters<typeof total>[1]) => total(ytdRows, key) + total(rows, key);
  // A goal counts as Executive › Goals counts it (the app's figure, else the sheet's).
  const asGoals = (rs: readonly ImpactRow[], lines: readonly string[]) => rs.filter((r) => lines.includes(r.line)).reduce((s, r) => s + (r.native || r.fromSheet), 0);
  const out: ReportSection[] = [];
  const inputs: AnalysisSection[] = [];
  const program = (groupName: string) => {
    const g = IMPACT_GROUPS.find((x) => x.group === groupName)!;
    const figures: Figure[] = g.lines.map((l) => ({ label: `${l.label} (${l.unit})`, value: total(rows, l.key), previous: total(previous, l.key), ytd: ytdOf(l.key) }));
    // The year's goal counts some of the group's lines together: its own row, against the year to date.
    const goal = goals[g.group];
    const sumOf = (rs: readonly ImpactRow[]) => (goal ? asGoals(rs, goal.lines) : 0);
    const compared: Figure[] = goal ? [...figures, { label: `Goal: ${goal.label}`, value: sumOf(rows), previous: sumOf(previous), ytd: sumOf(ytdRows) + sumOf(rows), goal: goal.target, derived: true }] : figures;
    const tableRows = g.lines.map((l) => [l.label, ...buckets.map((b) => shown(cell(rows, l.key, b.key))), total(rows, l.key), ytdOf(l.key)]);
    out.push({
      heading: g.group,
      description: withNote(g.group, g.description),
      kpis: figureKpis(figures),
      table: totalsOnly
        ? compare(compared)
        : { columns: ["Line", ...buckets.map((b) => b.label), "Total", ytdLabel], rows: tableRows, totals: g.lines.length > 1 ? ["Total", ...buckets.map((b) => g.lines.reduce((s, l) => s + shown(cell(rows, l.key, b.key)), 0)), g.lines.reduce((s, l) => s + total(rows, l.key), 0), g.lines.reduce((s, l) => s + ytdOf(l.key), 0)] : undefined },
      chart: totalsOnly ? twoBars(figures) : { kind: g.lines.length > 1 ? "stacked" : "bar", labels: buckets.map((b) => b.label), series: g.lines.map((l) => ({ label: l.label, values: buckets.map((b) => shown(cell(rows, l.key, b.key))) })) },
    });
    inputs.push({ heading: g.group, description: g.description, kpis: figureInput(figures) });
  };
  // A section of figures only (no columns by period): the comparison table, the two-bar chart, and any table of its own.
  const figuresSection = (heading: string, description: string, figures: Figure[], table?: { columns: string[]; rows: (string | number)[][]; totals?: (string | number)[] }, chart?: { labels: string[]; values: number[]; label: string }) => {
    out.push({
      heading,
      description,
      kpis: figureKpis(figures),
      table: table && !totalsOnly ? table : compare(figures),
      chart: chart ? { kind: "rank", labels: chart.labels, series: [{ label: chart.label, values: chart.values }] } : twoBars(figures),
    });
    inputs.push({ heading, description, kpis: figureInput(figures) });
  };
  const extra = (heading: string, description: string, x: { figures: Figure[]; rows: Record<string, string | number>[] } | undefined, columns: string[], keys: string[], chart: { kind: "bar" | "stacked"; series: { label: string; key: string }[] }) => {
    if (!x) return;
    out.push({
      heading,
      description,
      kpis: figureKpis(x.figures),
      table: totalsOnly ? compare(x.figures) : { columns, rows: x.rows.map((r) => keys.map((k) => r[k] ?? "")), totals: ["Total", ...keys.slice(1).map((k) => x.rows.reduce((s, r) => s + Number(r[k] ?? 0), 0))] },
      chart: totalsOnly ? twoBars(x.figures) : { kind: chart.kind, labels: x.rows.map((r) => String(r.label)), series: chart.series.map((s) => ({ label: s.label, values: x.rows.map((r) => Number(r[s.key] ?? 0)) })) },
    });
    inputs.push({ heading, description, kpis: figureInput(x.figures) });
  };

  for (const key of sections) {
    const group = GROUP_OF[key];
    if (group) {
      program(group);
      if (key === "transportation") extra("Transport & fuel", "Trips driven, kilometres from the odometer readings and pesos spent on fuel, from Transport.", extras.transport, ["Period", "Trips", "Km", "Fuel (PHP)"], ["label", "trips", "km", "fuel"], { kind: "bar", series: [{ label: "Trips", key: "trips" }, { label: "Km", key: "km" }] });
      if (key === "caf") extra("NCH billing", "The NCH Cancer Assistance Fund bills: pesos billed and paid, and the nights above the monthly cap that LAF absorbed.", extras.caf, ["Month", "Billed (PHP)", "Paid (PHP)", "Nights absorbed"], ["label", "billed", "paid", "absorbed"], { kind: "bar", series: [{ label: "Billed", key: "billed" }, { label: "Paid", key: "paid" }] });
      continue;
    }
    if (key === "donations") extra("Donations", "Cash gifts in pesos from the Donation Tracker and gifts in kind by the category each line was received under in LAF Inventory.", extras.donations, ["Period", "Cash (PHP)", "Food (PHP)", "Non-food (PHP)"], ["label", "cash", "food", "nonFood"], { kind: "stacked", series: [{ label: "Cash", key: "cash" }, { label: "Food", key: "food" }, { label: "Non-food", key: "nonFood" }] });
    if (key === "staff") extra("Staff hours", "Hours worked and late arrivals from the staff's clock-ins and clock-outs.", extras.staff, ["Period", "Hours", "Late arrivals"], ["label", "hours", "late"], { kind: "bar", series: [{ label: "Hours", key: "hours" }, { label: "Late", key: "late" }] });
    if (key === "headline" && extras.headline) figuresSection("Headline figures", "The foundation's main figures for the period, counted as the dashboard counts them.", extras.headline.figures);
    if (key === "occupancy" && extras.occupancy) figuresSection("Occupancy & beds", extras.occupancy.note, extras.occupancy.figures);
    if (key === "expenses" && extras.expenses) {
      const x = extras.expenses;
      figuresSection(
        "Expenses",
        x.note,
        x.figures,
        { columns: ["Account", "Amount (PHP)"], rows: x.byAccount.map((a) => [a.label, round2(a.amount)]), totals: ["Total", round2(x.byAccount.reduce((t, a) => t + a.amount, 0))] },
        x.byAccount.length ? { labels: x.byAccount.slice(0, 10).map((a) => a.label), values: x.byAccount.slice(0, 10).map((a) => a.amount), label: "Paid (PHP)" } : undefined,
      );
      if (x.byFund.length > 1) out.push({ heading: "Expenses by fund", description: "The same paid vouchers by the fund they were paid from.", table: { columns: ["Fund", "Amount (PHP)"], rows: x.byFund.map((a) => [a.label, round2(a.amount)]) }, chart: { kind: "rank", labels: x.byFund.map((a) => a.label), series: [{ label: "Paid (PHP)", values: x.byFund.map((a) => a.amount) }] } });
    }
    if (key === "inventory") extra("Inventory & gifts in kind", "Value of the goods received in LAF Inventory in the range, food and non-food, at the values on the receipts.", extras.inventory, ["Period", "Food (PHP)", "Non-food (PHP)"], ["label", "food", "nonFood"], { kind: "stacked", series: [{ label: "Food", key: "food" }, { label: "Non-food", key: "nonFood" }] });
  }
  // A profile's drawing: sideways bars, the table without a chart, or the figures only.
  const styleOf = (heading: string) => {
    const key = sections.find((k) => headingsOf(k).includes(heading));
    return key ? args.styles?.[key] : undefined;
  };
  const styled = out.map((sec) => {
    const st = styleOf(sec.heading);
    if (st === "figures") return { ...sec, table: undefined, chart: undefined };
    if (st === "table") return { ...sec, chart: undefined };
    if (st === "rank" && sec.chart) return { ...sec, chart: { ...sec.chart, kind: "rank" as const } };
    return sec;
  });
  return {
    spec: { title, subtitle: "The foundation's programs and operations for the period, from the app's records", period, previousPeriod, sections: styled },
    input: { title, period, previousPeriod, sections: inputs },
  };
}
