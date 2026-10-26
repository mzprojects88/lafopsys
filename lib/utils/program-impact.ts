// The Programs report (0112): the sheet's "Report" lines, computed from the app's records. Pure.

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

export interface ImpactRow {
  line: ImpactLine;
  month: number;
  native: number;
  fromSheet: number;
}

/** The sheet's groups, in its order; `href` is the page "View more" opens. */
export const IMPACT_GROUPS: { group: string; href: string; lines: { key: ImpactLine; label: string; unit: string }[] }[] = [
  { group: "Housing", href: "/patients/bed-nights", lines: [{ key: "housing", label: "People housed (child + companions, per night)", unit: "people-nights" }] },
  {
    group: "Transportation",
    href: "/transport/report",
    lines: [
      { key: "transport_to_nch", label: "To NCH", unit: "people" },
      { key: "transport_to_laf", label: "To LAF House", unit: "people" },
    ],
  },
  {
    group: "Meals @ LAF House",
    href: "/house-ops/meals",
    lines: [
      { key: "meals_breakfast", label: "Breakfast", unit: "people" },
      { key: "meals_lunch", label: "Lunch", unit: "people" },
      { key: "meals_dinner", label: "Dinner", unit: "people" },
    ],
  },
  {
    group: "Care Cart",
    href: "/house-ops/care-cart",
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
    lines: [
      { key: "center_nch_participants", label: "Participants", unit: "people" },
      { key: "center_nch_hours", label: "Hours", unit: "hours" },
      { key: "center_nch_volunteers", label: "Volunteers", unit: "volunteers" },
    ],
  },
  { group: "Activities @ LAF House", href: "/house-ops/activity-center", lines: [{ key: "center_laf_volunteers", label: "Volunteers", unit: "volunteers" }] },
  { group: "CAF", href: "/reports/caf-billing", lines: [{ key: "caf_nights", label: "Nights of children under the fund", unit: "nights" }] },
];

/** Lines whose group total is one of the website's five figures. */
export const DASHBOARD_LINES: Record<"housing" | "transportation" | "meals" | "center" | "care_cart", ImpactLine[]> = {
  housing: ["housing"],
  transportation: ["transport_to_nch", "transport_to_laf"],
  meals: ["meals_breakfast", "meals_lunch", "meals_dinner"],
  center: ["center_nch_participants"],
  care_cart: ["care_cart_1000", "care_cart_1200", "care_cart_1700"],
};

export const cell = (rows: readonly ImpactRow[], line: ImpactLine, month: number) => rows.find((r) => r.line === line && r.month === month) ?? { line, month, native: 0, fromSheet: 0 };

/** The month's figure to show: the app's once it has any, the sheet's until then. */
export const shown = (r: { native: number; fromSheet: number }) => Math.max(r.native, r.fromSheet);

export function ytd(rows: readonly ImpactRow[], line: ImpactLine, throughMonth: number, pick: (r: ImpactRow) => number = shown): number {
  return rows.filter((r) => r.line === line && r.month <= throughMonth).reduce((s, r) => s + pick(r), 0);
}

export type LineStatus = "live" | "catching_up" | "not_encoded" | "sheet_only";

/**
 * How far the app's own records have come for a line, judged on the current month: live when the
 * app's figure reaches the sheet's (or the sheet has nothing to compare), catching up when the app
 * has some, not encoded when nothing was recorded in the app this year; sheet_only for lines the
 * app does not record at all yet (transport history).
 */
export function lineStatus(rows: readonly ImpactRow[], line: ImpactLine, currentMonth: number): LineStatus {
  const year = rows.filter((r) => r.line === line);
  const nativeYear = year.reduce((s, r) => s + r.native, 0);
  const sheetYear = year.reduce((s, r) => s + r.fromSheet, 0);
  if (nativeYear === 0 && sheetYear === 0) return "sheet_only";
  if (nativeYear === 0) return "not_encoded";
  const now = cell(rows, line, currentMonth);
  return now.native >= now.fromSheet ? "live" : "catching_up";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The grid as CSV: one row per line, App and Sheet columns per month, YTD. */
export function impactCsv(rows: readonly ImpactRow[], year: number, throughMonth: number): string {
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const head = ["Group", "Line", "Unit", ...MONTHS.slice(0, throughMonth).flatMap((m) => [`${m} ${year} (app)`, `${m} ${year} (sheet)`]), "YTD (shown)"];
  const out = [head.map(q).join(",")];
  for (const g of IMPACT_GROUPS) {
    for (const l of g.lines) {
      const cells: (string | number)[] = [g.group, l.label, l.unit];
      for (let m = 1; m <= throughMonth; m++) {
        const c = cell(rows, l.key, m);
        cells.push(c.native, c.fromSheet);
      }
      cells.push(ytd(rows, l.key, throughMonth));
      out.push(cells.map((v) => (typeof v === "number" ? String(v) : q(v))).join(","));
    }
  }
  return out.join("\n");
}
