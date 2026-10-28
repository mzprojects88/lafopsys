/**
 * The weekly menu as the pages show it (0068): week dates, the status of a week, and whether
 * stock on hand covers a meal. Pure, framework-free; KEEP IDENTICAL in laf-inventory and the
 * Operating System (lib/utils/menu-week-ui.ts).
 */

export interface MenuMeal {
  id: string;
  date: string;
  mealType: string;
  status: "draft" | "pending_nutritionist" | "approved" | "rejected";
  servings: number;
  dish: string;
  recipeId: string;
  ingredients: { itemId: string; perServing?: number }[];
  source: "manual" | "ai";
  alternatives: { label: string; instruction: string; dish: string; note: string }[];
  dietCheck: { checked_at?: string; status: "ok" | "alternative" | "unchecked"; notes?: { label: string; issue: string }[]; alternatives?: { label: string; dish: string; note: string }[] } | null;
  notes: string;
  approvedBy: string | null;
  reviewNote: string | null;
}

export type WeekStatus = "empty" | "draft" | "pending" | "approved" | "rejected" | "mixed";

/** One status for the week: what the Send / Approve buttons act on. */
export function weekStatus(meals: readonly Pick<MenuMeal, "status">[]): WeekStatus {
  if (!meals.length) return "empty";
  const set = new Set(meals.map((m) => m.status));
  if (set.size > 1) return set.has("rejected") ? "rejected" : set.has("draft") ? "draft" : "mixed";
  const only = [...set][0]!;
  return only === "pending_nutritionist" ? "pending" : only;
}

export type StockStatus = "covered" | "short" | "unknown";

/**
 * Does stock on hand cover a meal? perServing × servings against on-hand per ingredient, summed
 * across the week's earlier meals that use the same item (so Friday's rice counts Monday's).
 * Unknown when the meal has no ingredients with quantities.
 */
export function stockStatus(meal: Pick<MenuMeal, "ingredients" | "servings">, onHand: ReadonlyMap<string, number>, alreadyNeeded: ReadonlyMap<string, number> = new Map()): { status: StockStatus; short: string[] } {
  const quantified = meal.ingredients.filter((i) => i.perServing && i.perServing > 0);
  if (!quantified.length) return { status: "unknown", short: [] };
  const short: string[] = [];
  for (const i of quantified) {
    const need = (alreadyNeeded.get(i.itemId) ?? 0) + i.perServing! * meal.servings;
    if (need > (onHand.get(i.itemId) ?? 0) + 1e-6) short.push(i.itemId);
  }
  return { status: short.length ? "short" : "covered", short };
}

/** The whole week's stock picture: each meal's status, charging items in date order. */
export function weekStock(meals: readonly MenuMeal[], onHand: ReadonlyMap<string, number>): Map<string, { status: StockStatus; short: string[] }> {
  const needed = new Map<string, number>();
  const out = new Map<string, { status: StockStatus; short: string[] }>();
  for (const m of [...meals].sort((a, b) => (a.date + a.mealType).localeCompare(b.date + b.mealType))) {
    out.set(m.id, stockStatus(m, onHand, needed));
    for (const i of m.ingredients) if (i.perServing && i.perServing > 0) needed.set(i.itemId, (needed.get(i.itemId) ?? 0) + i.perServing * m.servings);
  }
  return out;
}

/** The meal's picture against the food instructions, for the chip. */
export function dietLabel(meal: Pick<MenuMeal, "dietCheck" | "alternatives">): { label: string; tone: "positive" | "warning" | "neutral" } {
  if (!meal.dietCheck) return meal.alternatives.length ? { label: `${meal.alternatives.length} alternative plate${meal.alternatives.length === 1 ? "" : "s"}`, tone: "warning" } : { label: "Not checked", tone: "neutral" };
  if (meal.dietCheck.status === "ok") return { label: "Suits everyone", tone: "positive" };
  const n = meal.dietCheck.notes?.length ?? 0;
  return { label: `${n || 1} need${n === 1 ? "s" : ""} an alternative`, tone: "warning" };
}
