/**
 * Goals and budgets (0137), the pure parts: what each measure counts (the Program Impact lines it adds up), a
 * yearly figure spread over the months, when next year's budget is due and whether the bell should remind.
 */
import type { ImpactLine, ImpactRow } from "./program-impact.ts";

export type Measure = "housing" | "rides" | "meals" | "care_cart" | "center";
export type GoalMeasure = Measure | "donations" | "spending" | "none";

/** What ArkOS already counts, by measure: the Program Impact lines added together (0112/0128). */
export const MEASURES: Record<Measure, { label: string; unit: string; lines: ImpactLine[] }> = {
  housing: { label: "Patients and carers housed", unit: "people-nights", lines: ["housing"] },
  rides: { label: "Trips (to NCH and to LAF)", unit: "people-rides", lines: ["transport_to_nch", "transport_to_laf"] },
  meals: { label: "Meals served", unit: "people-meals", lines: ["meals_breakfast", "meals_lunch", "meals_dinner"] },
  care_cart: { label: "Care Cart served", unit: "people served", lines: ["care_cart_1000", "care_cart_1200", "care_cart_1700"] },
  center: { label: "Activity Center participants (NCH)", unit: "participants", lines: ["center_nch_participants"] },
};
export const GOAL_MEASURES: Record<GoalMeasure, string> = {
  ...Object.fromEntries(Object.entries(MEASURES).map(([k, m]) => [k, m.label])),
  donations: "Money raised (gifts, PHP)",
  spending: "Spending (vouchers, PHP)",
  none: "Written goal (no number)",
} as Record<GoalMeasure, string>;

/** A measure's count in a set of Program Impact rows (the app's own figure, else the sheet's, per line and bucket). */
export function measureTotal(rows: readonly ImpactRow[], measure: Measure, bucket?: string): number {
  const lines = MEASURES[measure].lines;
  return rows.filter((r) => lines.includes(r.line) && (!bucket || r.bucket === bucket)).reduce((s, r) => s + (r.native || r.fromSheet), 0);
}

/** A yearly figure over 12 months, to the centavo, the rounding left in December so the months add up to it. */
export function spreadYear(total: number): number[] {
  const each = Math.floor((total / 12) * 100) / 100;
  const months = Array.from({ length: 12 }, () => each);
  months[11] = Math.round((total - each * 11) * 100) / 100;
  return months;
}

/** The day `year`'s budget is due: the setting's month and day of the year before, clamped to the month's length. */
export function budgetDue(year: number, month: number, day: number): string {
  const last = new Date(Date.UTC(year - 1, month, 0)).getUTCDate();
  return `${year - 1}-${String(month).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
}

/**
 * Whether the bell reminds about next year's budget on `today`: from `remindDays` before it is due until it is
 * approved (overdue after the due day). Null when there is nothing to remind.
 */
export function budgetReminder(today: string, settings: { month: number; day: number; remindDays: number }, approvedYears: readonly number[]): { year: number; due: string; overdue: boolean } | null {
  const year = Number(today.slice(0, 4)) + 1;
  if (approvedYears.includes(year)) return null;
  const due = budgetDue(year, settings.month, settings.day);
  const from = new Date(`${due}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - settings.remindDays);
  return today >= from.toISOString().slice(0, 10) ? { year, due, overdue: today > due } : null;
}
