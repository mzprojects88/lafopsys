// The Programs report (0112, any range since 0128): the sheet's "Report" lines, computed from the
// app's records and broken into days, weeks or months. Pure: loads under `node --test`.

import { addDays, weekKey } from "./dtr.ts";
import { monthStart, shiftAnchor, type DayWindow } from "./period.ts";
import type { AnalysisInput } from "../ai/report-analysis.ts";
import type { ReportSpec } from "../pdf/report-doc.ts";

export type ImpactLine =
  | "housing"
  | "transport_to_nch"
  | "transport_to_laf"
  | "meals_breakfast"
  | "meals_lunch"
  | "meals_dinner"
  | "care_cart_1000"
  | "care_cart_1200"
  | "care_cart_1700"
  | "care_cart_volunteers"
  | "center_nch_participants"
  | "center_nch_hours"
  | "center_nch_volunteers"
  | "center_laf_volunteers"
  | "caf_nights";

export type Grain = "day" | "week" | "month";

export interface ImpactRow {
  line: ImpactLine;
  /** The bucket's first day (`yyyy-MM-dd`): the day, the week's Monday or the month's 1st. */
  bucket: string;
  native: number;
  fromSheet: number;
}

/** The sheet's groups, in its order; `href` is the page "View more" opens; `description` is what the figures count. */
export const IMPACT_GROUPS: { group: string; href: string; description: string; lines: { key: ImpactLine; label: string; unit: string }[] }[] = [
  {
    group: "Housing",
    href: "/patients/bed-nights",
    description: "People housed per night: each confirmed bed night counts the child plus the companions staying with them (people-nights), from the admission board.",
    lines: [{ key: "housing", label: "People housed (child + companions, per night)", unit: "people-nights" }],
  },
  {
    group: "Transportation",
    href: "/transport/report",
    description: "Passengers on trips to NCH and back to LAF House, one count per person per way, from the Transport trips and their manifests.",
    lines: [
      { key: "transport_to_nch", label: "To NCH", unit: "people" },
      { key: "transport_to_laf", label: "To LAF House", unit: "people" },
    ],
  },
  {
    group: "Meals @ LAF House",
    href: "/house-ops/meals",
    description: "People served at breakfast, lunch and dinner: each meal tick on the admission board counts the child plus the companions staying.",
    lines: [
      { key: "meals_breakfast", label: "Breakfast", unit: "people" },
      { key: "meals_lunch", label: "Lunch", unit: "people" },
      { key: "meals_dinner", label: "Dinner", unit: "people" },
    ],
  },
  {
    group: "Care Cart",
    href: "/house-ops/care-cart",
    description: "People served at each Care Cart run (10:00 AM, 12:00 NN, 5:00 PM) and the volunteers who helped, from the runs recorded in LAF Inventory.",
    lines: [
      { key: "care_cart_1000", label: "10:00 AM", unit: "people" },
      { key: "care_cart_1200", label: "12:00 NN", unit: "people" },
      { key: "care_cart_1700", label: "5:00 PM", unit: "people" },
      { key: "care_cart_volunteers", label: "Volunteers", unit: "volunteers" },
    ],
  },
  {
    group: "LAF Center @ NCH",
    href: "/house-ops/activity-center",
    description: "Participants, hours and volunteers of the sessions held at the LAF Center inside NCH, from House Operations > Activity Center.",
    lines: [
      { key: "center_nch_participants", label: "Participants", unit: "people" },
      { key: "center_nch_hours", label: "Hours", unit: "hours" },
      { key: "center_nch_volunteers", label: "Volunteers", unit: "volunteers" },
    ],
  },
  {
    group: "Activities @ LAF House",
    href: "/house-ops/activity-center",
    description: "Volunteers at activities held at LAF House, from Activity Center sessions marked LAF.",
    lines: [{ key: "center_laf_volunteers", label: "Volunteers", unit: "volunteers" }],
  },
  {
    group: "CAF",
    href: "/reports/caf-billing",
    description: "Nights of children covered by the NCH Cancer Assistance Fund: bed nights of children flagged for CAF billing.",
    lines: [{ key: "caf_nights", label: "Nights of children under the fund", unit: "nights" }],
  },
];

/** Lines whose group total is one of the website's five figures. */
export const DASHBOARD_LINES: Record<"housing" | "transportation" | "meals" | "center" | "care_cart", ImpactLine[]> = {
  housing: ["housing"],
  transportation: ["transport_to_nch", "transport_to_laf"],
  meals: ["meals_breakfast", "meals_lunch", "meals_dinner"],
  center: ["center_nch_participants"],
  care_cart: ["care_cart_1000", "care_cart_1200", "care_cart_1700"],
};

export const DASHBOARD_LABELS: Record<keyof typeof DASHBOARD_LINES, string> = { housing: "Housing", transportation: "Transportation", meals: "Meals", center: "LAF Center @ NCH", care_cart: "Care Cart" };

export const cell = (rows: readonly ImpactRow[], line: ImpactLine, bucket: string) => rows.find((r) => r.line === line && r.bucket === bucket) ?? { line, bucket, native: 0, fromSheet: 0 };

/** The bucket's figure to show: the app's once it has any, the sheet's until then. */
export const shown = (r: { native: number; fromSheet: number }) => Math.max(r.native, r.fromSheet);

/** A line's total over every bucket in the rows. */
export function total(rows: readonly ImpactRow[], line: ImpactLine, pick: (r: ImpactRow) => number = shown): number {
  return rows.filter((r) => r.line === line).reduce((s, r) => s + pick(r), 0);
}

export type LineStatus = "live" | "catching_up" | "not_encoded" | "sheet_only";

/**
 * How far the app's own records have come for a line, judged on the latest bucket: live when the
 * app's figure reaches the sheet's (or the sheet has nothing to compare), catching up when the app
 * has some, not encoded when nothing was recorded in the app in the range; sheet_only for lines
 * neither source has.
 */
export function lineStatus(rows: readonly ImpactRow[], line: ImpactLine, lastBucket: string): LineStatus {
  const mine = rows.filter((r) => r.line === line);
  const nativeAll = mine.reduce((s, r) => s + r.native, 0);
  const sheetAll = mine.reduce((s, r) => s + r.fromSheet, 0);
  if (nativeAll === 0 && sheetAll === 0) return "sheet_only";
  if (nativeAll === 0) return "not_encoded";
  const now = cell(rows, line, lastBucket);
  return now.native >= now.fromSheet ? "live" : "catching_up";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayLabel = (key: string) => `${MONTHS[Number(key.slice(5, 7)) - 1]} ${Number(key.slice(8, 10))}`;

export interface Bucket {
  /** As the database names it: the bucket's first day. */
  key: string;
  label: string;
}

/** The buckets a window breaks into, the same ones `date_trunc` gives the database, with short labels. */
export function bucketsFor(window: DayWindow, grain: Grain): Bucket[] {
  const out: Bucket[] = [];
  if (grain === "day") {
    for (let d = window.from; d <= window.to; d = addDays(d, 1)) out.push({ key: d, label: dayLabel(d) });
  } else if (grain === "week") {
    // The key stays the week's Monday (as date_trunc); the label is clipped to the window, so a month starts on day 1.
    for (let d = weekKey(window.from); d <= window.to; d = addDays(d, 7)) {
      const start = d < window.from ? window.from : d;
      const end = addDays(d, 6) > window.to ? window.to : addDays(d, 6);
      out.push({ key: d, label: start === end ? dayLabel(start) : end.slice(5, 7) === start.slice(5, 7) ? `${dayLabel(start)}–${Number(end.slice(8, 10))}` : `${dayLabel(start)}–${dayLabel(end)}` });
    }
  } else {
    const sameYear = window.from.slice(0, 4) === window.to.slice(0, 4);
    for (let d = monthStart(window.from); d <= window.to; d = shiftAnchor("month", d, 1)) out.push({ key: d, label: sameYear ? MONTHS[Number(d.slice(5, 7)) - 1]! : `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}` });
  }
  return out;
}

/** The grain a window's figures are counted in, as ops.dashboard_figures (0147): days up to 14, weeks up to 120 days,
 * then months, so the dashboard and the reports agree for the same period. */
export function periodGrain(window: DayWindow): Grain {
  const days = Math.round((Date.parse(window.to) - Date.parse(window.from)) / 86_400_000) + 1;
  return days <= 14 ? "day" : days <= 120 ? "week" : "month";
}

/** "+20%", "-5%", "new" (from nothing), or "" when both are nothing. */
export function changeLabel(current: number, previous: number): string {
  if (previous === 0) return current === 0 ? "" : "new";
  const pct = Math.round(((current - previous) / previous) * 100);
  return `${pct >= 0 ? "+" : ""}${pct}%`;
}

const num = (n: number) => (Number.isInteger(n) ? n.toLocaleString("en-US") : n.toLocaleString("en-US", { maximumFractionDigits: 1 }));

/** The grid as CSV: one row per line, App and Sheet columns per bucket, Total. */
export function impactCsv(rows: readonly ImpactRow[], buckets: readonly Bucket[]): string {
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const head = ["Group", "Line", "Unit", ...buckets.flatMap((b) => [`${b.label} (app)`, `${b.label} (sheet)`]), "Total (shown)"];
  const out = [head.map(q).join(",")];
  for (const g of IMPACT_GROUPS) {
    for (const l of g.lines) {
      const cells: (string | number)[] = [g.group, l.label, l.unit];
      for (const b of buckets) {
        const c = cell(rows, l.key, b.key);
        cells.push(c.native, c.fromSheet);
      }
      cells.push(total(rows, l.key));
      out.push(cells.map((v) => (typeof v === "number" ? String(v) : q(v))).join(","));
    }
  }
  return out.join("\n");
}

/** The report as the branded document prints it, and the figures the AI compares; one source for both. */
export function programReport(args: { rows: readonly ImpactRow[]; previous: readonly ImpactRow[]; buckets: readonly Bucket[]; period: string; previousPeriod: string }): { spec: ReportSpec; input: AnalysisInput } {
  const { rows, previous, buckets, period, previousPeriod } = args;
  const sections = IMPACT_GROUPS.map((g) => {
    const kpis = g.lines.map((l) => {
      const cur = total(rows, l.key);
      const prev = total(previous, l.key);
      return { label: `${l.label} (${l.unit})`, value: num(cur), previous: num(prev), change: changeLabel(cur, prev), cur, prev };
    });
    const tableRows = g.lines.map((l) => [l.label, ...buckets.map((b) => shown(cell(rows, l.key, b.key))), total(rows, l.key)]);
    const totals = g.lines.length > 1 ? ["Total", ...buckets.map((b) => g.lines.reduce((s, l) => s + shown(cell(rows, l.key, b.key)), 0)), g.lines.reduce((s, l) => s + total(rows, l.key), 0)] : undefined;
    return {
      heading: g.group,
      description: g.description,
      kpis: kpis.map(({ label, value, previous: p, change }) => ({ label, value, previous: p, change })),
      table: { columns: ["Line", ...buckets.map((b) => b.label), "Total"], rows: tableRows, totals },
      chart: { kind: (g.lines.length > 1 ? "stacked" : "bar") as "stacked" | "bar", labels: buckets.map((b) => b.label), series: g.lines.map((l) => ({ label: l.label, values: buckets.map((b) => shown(cell(rows, l.key, b.key))) })) },
      input: { heading: g.group, description: g.description, kpis: kpis.map((k) => ({ label: k.label, value: k.cur, previous: k.prev })) },
    };
  });
  return {
    spec: { title: "Programs Report", subtitle: "Housing, transportation, meals, Care Cart, LAF Center and CAF, from the app's records", period, previousPeriod, sections: sections.map((s) => ({ heading: s.heading, description: s.description, kpis: s.kpis, table: s.table, chart: s.chart })) },
    input: { title: "Programs Report", period, previousPeriod, sections: sections.map((s) => s.input) },
  };
}
