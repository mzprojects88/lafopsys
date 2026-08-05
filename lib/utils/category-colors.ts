/**
 * Per-category accent palette — matches the OPS FE reference mocks, where
 * every module/icon-circle/avatar carries a soft-tint color (e.g. Staff &
 * Time = blue, Patients = purple, House Ops = orange, Donors = rose,
 * Inventory = teal, Financial = green). Reused by IconCircle, KpiCard,
 * avatars, and the sidebar nav icons.
 */
export type CategoryColor =
  | "blue"
  | "cyan"
  | "teal"
  | "green"
  | "amber"
  | "orange"
  | "purple"
  | "indigo"
  | "rose"
  | "red"
  | "slate";

interface CategoryColorClasses {
  bg: string;
  text: string;
  ring?: string;
}

export const CATEGORY_COLOR_CLASSES: Record<CategoryColor, CategoryColorClasses> = {
  blue: { bg: "bg-blue-50 dark:bg-blue-500/10", text: "text-blue-600 dark:text-blue-400" },
  cyan: { bg: "bg-cyan-50 dark:bg-cyan-500/10", text: "text-cyan-600 dark:text-cyan-400" },
  teal: { bg: "bg-teal-50 dark:bg-teal-500/10", text: "text-teal-600 dark:text-teal-400" },
  green: { bg: "bg-emerald-50 dark:bg-emerald-500/10", text: "text-emerald-600 dark:text-emerald-400" },
  amber: { bg: "bg-amber-50 dark:bg-amber-500/10", text: "text-amber-600 dark:text-amber-400" },
  orange: { bg: "bg-orange-50 dark:bg-orange-500/10", text: "text-orange-600 dark:text-orange-400" },
  purple: { bg: "bg-violet-50 dark:bg-violet-500/10", text: "text-violet-600 dark:text-violet-400" },
  indigo: { bg: "bg-indigo-50 dark:bg-indigo-500/10", text: "text-indigo-600 dark:text-indigo-400" },
  rose: { bg: "bg-rose-50 dark:bg-rose-500/10", text: "text-rose-600 dark:text-rose-400" },
  red: { bg: "bg-red-50 dark:bg-red-500/10", text: "text-red-600 dark:text-red-400" },
  slate: { bg: "bg-slate-100 dark:bg-slate-500/10", text: "text-slate-600 dark:text-slate-400" },
};

/** One accent color per module, matching the sidebar/dashboard icon colors in the reference. */
export const MODULE_COLOR: Record<string, CategoryColor> = {
  dashboard: "blue",
  staff: "cyan",
  patients: "purple",
  "house-ops": "orange",
  donors: "rose",
  inventory: "teal",
  finance: "green",
  analytics: "indigo",
  reports: "slate",
  settings: "slate",
};

export function categoryClasses(color: CategoryColor): CategoryColorClasses {
  return CATEGORY_COLOR_CLASSES[color];
}
