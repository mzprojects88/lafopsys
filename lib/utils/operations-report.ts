// The Report generator's document (Reports > Generate, Nov 2026): the programs (the Programs
// report's lines), donations, transport, staff hours, NCH billing and inventory figures for a range,
// each with the previous range beside it, as one ReportSpec and one AnalysisInput. Pure.

import type { AnalysisInput, AnalysisSection } from "../ai/report-analysis.ts";
import type { ReportSection, ReportSpec } from "../pdf/report-doc.ts";
import { IMPACT_GROUPS, cell, changeLabel, shown, total, type Bucket, type ImpactRow } from "./program-impact.ts";

export type GeneratorSectionKey = "housing" | "transportation" | "meals" | "care_cart" | "center" | "activities" | "caf" | "donations" | "staff" | "inventory";

export const GENERATOR_SECTIONS: { key: GeneratorSectionKey; label: string }[] = [
  { key: "housing", label: "Housing" },
  { key: "transportation", label: "Transportation" },
  { key: "meals", label: "Meals" },
  { key: "care_cart", label: "Care Cart" },
  { key: "center", label: "LAF Center @ NCH" },
  { key: "activities", label: "Activities @ LAF House" },
  { key: "caf", label: "CAF / NCH billing" },
  { key: "donations", label: "Donations" },
  { key: "staff", label: "Staff hours" },
  { key: "inventory", label: "Inventory & gifts in kind" },
];

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
}

export interface GeneratorExtras {
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
function figureKpis(figures: Figure[]) {
  return figures.map((f) => ({ label: f.label, value: fmt(f, f.value), previous: fmt(f, f.previous), change: variance(f) }));
}
/** The comparison table of a section shown as totals: each figure for the period, the one before, the variance, the
 * year to date, and the year's goal where there is one. */
function comparison(figures: Figure[], period: string, previousPeriod: string, ytdLabel: string, goalYear: number) {
  const goals = figures.some((f) => f.goal != null);
  return {
    columns: ["Figure", period, previousPeriod, "Variance", "%", ytdLabel, ...(goals ? [`Goal ${goalYear}`, "% of goal"] : [])],
    rows: figures.map((f) => [
      f.unit === "PHP" ? `${f.label} (PHP)` : f.unit ? `${f.label} (${f.unit})` : f.label,
      round2(f.value),
      round2(f.previous),
      round2(f.value - f.previous),
      changeLabel(f.value, f.previous) || "—",
      f.ytd == null ? "—" : round2(f.ytd),
      ...(goals ? [f.goal == null ? "—" : round2(f.goal), f.goal ? `${Math.round(((f.ytd ?? 0) / f.goal) * 100)}%` : "—"] : []),
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
  /** The programs' rows for the year to date, its label ("YTD 2026") and year. */
  ytdRows?: readonly ImpactRow[];
  ytdLabel?: string;
  goalYear?: number;
  /** The year's goals by Programs group ("Housing", "Meals @ LAF House" …): the lines the goal counts and its target. */
  goals?: Record<string, { label: string; lines: string[]; target: number }>;
}): { spec: ReportSpec; input: AnalysisInput } {
  const { sections, rows, previous, buckets, extras, period, previousPeriod, totalsOnly = false, ytdRows = [], ytdLabel = "Year to date", goalYear = 0, goals = {} } = args;
  const compare = (figures: Figure[]) => comparison(figures, period, previousPeriod, ytdLabel, goalYear);
  const twoBars = (figures: Figure[]) => ({ kind: "bar" as const, labels: [previousPeriod, period], series: figures.map((f) => ({ label: f.label, values: [f.previous, f.value] })) });
  const out: ReportSection[] = [];
  const inputs: AnalysisSection[] = [];
  const program = (groupName: string) => {
    const g = IMPACT_GROUPS.find((x) => x.group === groupName)!;
    const figures: Figure[] = g.lines.map((l) => ({ label: `${l.label} (${l.unit})`, value: total(rows, l.key), previous: total(previous, l.key), ytd: total(ytdRows, l.key) }));
    // The year's goal counts some of the group's lines together: its own row, against the year to date.
    const goal = goals[g.group];
    const sumOf = (rs: readonly ImpactRow[]) => (goal ? g.lines.filter((l) => goal.lines.includes(l.key)).reduce((s, l) => s + total(rs, l.key), 0) : 0);
    const compared: Figure[] = goal ? [...figures, { label: `Goal: ${goal.label}`, value: sumOf(rows), previous: sumOf(previous), ytd: sumOf(ytdRows), goal: goal.target }] : figures;
    const tableRows = g.lines.map((l) => [l.label, ...buckets.map((b) => shown(cell(rows, l.key, b.key))), total(rows, l.key), total(ytdRows, l.key)]);
    out.push({
      heading: g.group,
      description: g.description,
      kpis: figureKpis(figures),
      table: totalsOnly
        ? compare(compared)
        : { columns: ["Line", ...buckets.map((b) => b.label), "Total", ytdLabel], rows: tableRows, totals: g.lines.length > 1 ? ["Total", ...buckets.map((b) => g.lines.reduce((s, l) => s + shown(cell(rows, l.key, b.key)), 0)), g.lines.reduce((s, l) => s + total(rows, l.key), 0), g.lines.reduce((s, l) => s + total(ytdRows, l.key), 0)] : undefined },
      chart: totalsOnly ? twoBars(figures) : { kind: g.lines.length > 1 ? "stacked" : "bar", labels: buckets.map((b) => b.label), series: g.lines.map((l) => ({ label: l.label, values: buckets.map((b) => shown(cell(rows, l.key, b.key))) })) },
    });
    inputs.push({ heading: g.group, description: g.description, kpis: figureInput(figures) });
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
    if (key === "inventory") extra("Inventory & gifts in kind", "Value of the goods received in LAF Inventory in the range, food and non-food, at the values on the receipts.", extras.inventory, ["Period", "Food (PHP)", "Non-food (PHP)"], ["label", "food", "nonFood"], { kind: "stacked", series: [{ label: "Food", key: "food" }, { label: "Non-food", key: "nonFood" }] });
  }
  return {
    spec: { title: "Operations Report", subtitle: "The foundation's programs and operations for the range, from the app's records", period, previousPeriod, sections: out },
    input: { title: "Operations Report", period, previousPeriod, sections: inputs },
  };
}
