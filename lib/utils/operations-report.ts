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

function figureKpis(figures: Figure[]) {
  return figures.map((f) => ({ label: f.label, value: fmt(f, f.value), previous: fmt(f, f.previous), change: changeLabel(f.value, f.previous) }));
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
}): { spec: ReportSpec; input: AnalysisInput } {
  const { sections, rows, previous, buckets, extras, period, previousPeriod } = args;
  const out: ReportSection[] = [];
  const inputs: AnalysisSection[] = [];
  const program = (groupName: string) => {
    const g = IMPACT_GROUPS.find((x) => x.group === groupName)!;
    const figures: Figure[] = g.lines.map((l) => ({ label: `${l.label} (${l.unit})`, value: total(rows, l.key), previous: total(previous, l.key) }));
    const tableRows = g.lines.map((l) => [l.label, ...buckets.map((b) => shown(cell(rows, l.key, b.key))), total(rows, l.key)]);
    out.push({
      heading: g.group,
      description: g.description,
      kpis: figureKpis(figures),
      table: { columns: ["Line", ...buckets.map((b) => b.label), "Total"], rows: tableRows, totals: g.lines.length > 1 ? ["Total", ...buckets.map((b) => g.lines.reduce((s, l) => s + shown(cell(rows, l.key, b.key)), 0)), g.lines.reduce((s, l) => s + total(rows, l.key), 0)] : undefined },
      chart: { kind: g.lines.length > 1 ? "stacked" : "bar", labels: buckets.map((b) => b.label), series: g.lines.map((l) => ({ label: l.label, values: buckets.map((b) => shown(cell(rows, l.key, b.key))) })) },
    });
    inputs.push({ heading: g.group, description: g.description, kpis: figureInput(figures) });
  };
  const extra = (heading: string, description: string, x: { figures: Figure[]; rows: Record<string, string | number>[] } | undefined, columns: string[], keys: string[], chart: { kind: "bar" | "stacked"; series: { label: string; key: string }[] }) => {
    if (!x) return;
    out.push({
      heading,
      description,
      kpis: figureKpis(x.figures),
      table: { columns, rows: x.rows.map((r) => keys.map((k) => r[k] ?? "")), totals: ["Total", ...keys.slice(1).map((k) => x.rows.reduce((s, r) => s + Number(r[k] ?? 0), 0))] },
      chart: { kind: chart.kind, labels: x.rows.map((r) => String(r.label)), series: chart.series.map((s) => ({ label: s.label, values: x.rows.map((r) => Number(r[s.key] ?? 0)) })) },
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
