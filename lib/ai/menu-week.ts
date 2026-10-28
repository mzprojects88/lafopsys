/**
 * The weekly menu's AI (Inventory 0068 / lafopsys 0120): what the model is asked, the shape it
 * must answer in, and the checks on its answer. KEEP THIS FILE IDENTICAL in laf-inventory and
 * LAF Operating System (lib/ai/menu-week.ts): both apps suggest and check menus with it, against
 * the same facts from inventory.menu_week_facts. Framework-free: a plain fetch to OpenAI.
 *
 * Nothing personal reaches the model: people under a doctor's instruction are "Person 1",
 * "Person 2" in the facts, and the model answers with those labels.
 */

export interface MenuWeekFacts {
  week_start: string;
  dietary_rules: string | null;
  headcount: Record<string, number>;
  stock: { item_id: string; name: string; uom: string; pack: string | null; qty: number; expires: string | null }[];
  dishes: { recipe_id: string; name: string; meal_type: string | null; ingredients: { itemId: string; perServing?: number }[] }[];
  recent: { date: string; meal_type: string; dish: string }[];
  instructions: { label: string; applies_to: "patient" | "carer"; instruction: string; until: string | null }[];
  instruction_ids: Record<string, string>;
  meal_types: string[];
}

export interface SuggestedMeal {
  date: string;
  meal_type: string;
  dish: string;
  recipe_id: string | null;
  ingredients: { itemId: string; perServing: number }[];
  servings: number;
  notes: string;
  alternatives: { label: string; instruction: string; dish: string; note: string }[];
}

export interface MenuSuggestion {
  meals: SuggestedMeal[];
  shopping: { name: string; note: string }[];
  summary: string;
}

export interface MealCheck {
  plan_id: string;
  status: "ok" | "alternative";
  notes: { label: string; issue: string }[];
  alternatives: { label: string; dish: string; note: string }[];
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The seven dates of a week, Monday first. */
export function weekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(`${weekStart}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

/** The Monday of the week a date falls in. */
export function mondayOf(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (dow - 1));
  return d.toISOString().slice(0, 10);
}

const str = { type: "string" } as const;
const num = { type: "number" } as const;
const obj = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const arr = (items: unknown) => ({ type: "array", items });

export const SUGGEST_SCHEMA = obj({
  meals: arr(
    obj({
      date: str,
      meal_type: str,
      dish: str,
      recipe_id: { type: ["string", "null"] },
      ingredients: arr(obj({ item_id: str, per_serving: num })),
      servings: { type: "integer" },
      notes: str,
      alternatives: arr(obj({ label: str, dish: str, note: str })),
    })
  ),
  shopping: arr(obj({ name: str, note: str })),
  summary: str,
});

export const CHECK_SCHEMA = obj({
  checks: arr(
    obj({
      plan_id: str,
      status: { type: "string", enum: ["ok", "alternative"] },
      notes: arr(obj({ label: str, issue: str })),
      alternatives: arr(obj({ label: str, dish: str, note: str })),
    })
  ),
});

const SAFETY = "Food safety for a house of children in cancer treatment: every dish fully cooked, no raw or undercooked egg, meat or seafood, no unpasteurised milk products, fruit and vegetables washed and peeled where they are served raw.";

const factsForModel = (f: MenuWeekFacts) => ({
  week: weekDates(f.week_start),
  meal_types: f.meal_types,
  headcount_per_meal: f.headcount,
  dietary_rules: f.dietary_rules ?? "(none written yet)",
  food_instructions: f.instructions.map((i) => ({ label: i.label, who: i.applies_to === "carer" ? "a carer" : "a child", instruction: i.instruction })),
  stock_on_hand: f.stock.map((s) => ({ item_id: s.item_id, name: s.name, unit: s.uom, pack: s.pack ?? undefined, qty: s.qty, expires: s.expires ?? undefined })),
  known_dishes: f.dishes.map((d) => ({ recipe_id: d.recipe_id, name: d.name, meal_type: d.meal_type ?? undefined })),
  served_last_two_weeks: f.recent,
});

export function buildSuggestPrompt(f: MenuWeekFacts): string {
  return (
    "You plan the week's meals for Little Ark Foundation, a halfway house in Manila for children in cancer treatment and the parent or carer staying with each child. Simple Filipino home cooking the house can make in one kitchen; nothing fancy. " +
    `Plan every date in "week" for every meal type in "meal_types". Use stock_on_hand first, the soonest-expiring items first, and keep what is bought to a minimum. ` +
    "Each meal's ingredients must use item_id values from stock_on_hand only, with per_serving in that item's unit (rice about 0.1 kg per serving, chicken about 0.12 kg, vegetables about 0.08 kg, cooking oil about 0.01 L, eggs 1 piece). Anything a dish needs that is not in stock goes in shopping, by name. " +
    "servings = headcount_per_meal for that meal type (25 when missing). Vary the dishes: no dish twice in the same three days, and avoid what served_last_two_weeks lists. Reuse known_dishes by recipe_id when the dish is the same; a new dish has recipe_id null. " +
    `Follow dietary_rules strictly. ${SAFETY} ` +
    "For every food instruction, make the meal suit that person where you can; when a meal can't, add an alternative plate for that label (its dish and a short note) so nobody is left without a suitable meal. Never guess a diagnosis; use the instruction as written. " +
    "notes: under 15 words, only when something matters (expiring stock used, a plate to cook separately). summary: two sentences on how the week uses the stock and what must be bought.\n\n" +
    `Facts: ${JSON.stringify(factsForModel(f))}`
  );
}

export function buildCheckPrompt(f: MenuWeekFacts, meals: { plan_id: string; date: string; meal_type: string; dish: string; ingredients: { name: string }[]; alternatives: { label: string; dish: string }[] }[]): string {
  return (
    "You check a house's planned meals against the doctors' food instructions for the people staying there (children in cancer treatment and their carers). " +
    `${SAFETY} Follow dietary_rules as well. ` +
    "For each planned meal answer by plan_id: status ok when every person under an instruction can eat it (counting an alternative plate already planned for them), otherwise alternative with one note per affected label (the issue in under 12 words) and an alternative plate (dish and a short note) for each affected label that has none yet. Use the labels exactly as given; never guess a diagnosis.\n\n" +
    `dietary_rules: ${f.dietary_rules ?? "(none written yet)"}\nfood_instructions: ${JSON.stringify(f.instructions.map((i) => ({ label: i.label, who: i.applies_to === "carer" ? "a carer" : "a child", instruction: i.instruction })))}\n` +
    `planned_meals: ${JSON.stringify(meals)}`
  );
}

/** The model's answer, checked against the facts: dates in the week, meal types known, ingredients from stock, sane numbers. */
export function validateSuggestion(raw: unknown, f: MenuWeekFacts): { ok: true; suggestion: MenuSuggestion } | { ok: false; error: string } {
  const r = raw as { meals?: unknown[]; shopping?: unknown[]; summary?: unknown } | null;
  if (!r || !Array.isArray(r.meals)) return { ok: false, error: "The model gave no meals." };
  const dates = new Set(weekDates(f.week_start));
  const types = new Set(f.meal_types);
  const stock = new Map(f.stock.map((s) => [s.item_id, s]));
  const dishIds = new Set(f.dishes.map((d) => d.recipe_id));
  const labels = new Set(f.instructions.map((i) => i.label));
  const seen = new Set<string>();
  const meals: SuggestedMeal[] = [];
  for (const m of r.meals as Record<string, unknown>[]) {
    const date = String(m.date ?? "");
    const mealType = String(m.meal_type ?? "").toLowerCase();
    const dish = String(m.dish ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
    if (!DAY.test(date) || !dates.has(date) || !types.has(mealType) || !dish || seen.has(`${date}|${mealType}`)) continue;
    seen.add(`${date}|${mealType}`);
    const ingredients = (Array.isArray(m.ingredients) ? (m.ingredients as Record<string, unknown>[]) : [])
      .map((i) => ({ itemId: String(i.item_id ?? ""), perServing: Number(i.per_serving) }))
      .filter((i) => stock.has(i.itemId) && Number.isFinite(i.perServing) && i.perServing > 0 && i.perServing <= 5);
    const recipeId = typeof m.recipe_id === "string" && dishIds.has(m.recipe_id) ? m.recipe_id : null;
    const servings = Math.min(200, Math.max(1, Math.round(Number(m.servings) || f.headcount[mealType] || 25)));
    const alternatives = (Array.isArray(m.alternatives) ? (m.alternatives as Record<string, unknown>[]) : [])
      .filter((a) => labels.has(String(a.label)))
      .map((a) => ({ label: String(a.label), instruction: f.instructions.find((i) => i.label === a.label)?.instruction ?? "", dish: String(a.dish ?? "").trim().slice(0, 120), note: String(a.note ?? "").trim().slice(0, 200) }))
      .filter((a) => a.dish);
    meals.push({ date, meal_type: mealType, dish, recipe_id: recipeId, ingredients, servings, notes: String(m.notes ?? "").trim().slice(0, 200), alternatives });
  }
  if (meals.length < dates.size * types.size * 0.8) return { ok: false, error: `The model planned only ${meals.length} of ${dates.size * types.size} meals. Try again.` };
  const shopping = (Array.isArray(r.shopping) ? (r.shopping as Record<string, unknown>[]) : []).map((s) => ({ name: String(s.name ?? "").trim().slice(0, 80), note: String(s.note ?? "").trim().slice(0, 120) })).filter((s) => s.name).slice(0, 40);
  return { ok: true, suggestion: { meals, shopping, summary: String(r.summary ?? "").trim().slice(0, 600) } };
}

export function validateChecks(raw: unknown, planIds: Set<string>, labels: Set<string>): MealCheck[] {
  const r = raw as { checks?: unknown[] } | null;
  return (Array.isArray(r?.checks) ? (r!.checks as Record<string, unknown>[]) : [])
    .filter((c) => planIds.has(String(c.plan_id)))
    .map((c) => ({
      plan_id: String(c.plan_id),
      status: c.status === "alternative" ? ("alternative" as const) : ("ok" as const),
      notes: (Array.isArray(c.notes) ? (c.notes as Record<string, unknown>[]) : []).filter((n) => labels.has(String(n.label))).map((n) => ({ label: String(n.label), issue: String(n.issue ?? "").slice(0, 120) })),
      alternatives: (Array.isArray(c.alternatives) ? (c.alternatives as Record<string, unknown>[]) : []).filter((a) => labels.has(String(a.label))).map((a) => ({ label: String(a.label), dish: String(a.dish ?? "").slice(0, 120), note: String(a.note ?? "").slice(0, 200) })).filter((a) => a.dish),
    }));
}

/** One OpenAI Responses call whose answer must match `schema`. Returns the parsed JSON, or why not. */
export async function askMenuModel(apiKey: string, input: string, name: string, schema: object, timeoutMs = 120_000): Promise<{ ok: true; data: unknown } | { ok: false; error: string; status: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: process.env.OPENAI_MODEL?.trim() || "gpt-5-mini", reasoning: { effort: "medium" }, input, text: { format: { type: "json_schema", name, strict: true, schema } } }),
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, error: "The suggestion service refused the request.", status: 502 };
    const data = (await res.json()) as { output?: { type: string; content?: { type: string; text?: string }[] }[] };
    const text = (data.output ?? []).flatMap((p) => (p.type === "message" ? (p.content ?? []) : [])).find((c) => c.type === "output_text")?.text ?? "";
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: false, error: "The suggestion took too long. Try again.", status: 504 };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// The two jobs, shared by both apps' routes. `rpc` is the signed-in person's Supabase client's
// inventory-schema rpc (the database checks their role), so a route only guards the key and rate.
// ---------------------------------------------------------------------------

export type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
export type JobResult<T> = { ok: true; result: T } | { ok: false; error: string; status: number };

const fail = (error: string, status: number): JobResult<never> => ({ ok: false, error, status });

export async function suggestWeek(rpc: Rpc, apiKey: string, weekStart: string, save: boolean): Promise<JobResult<MenuSuggestion & { saved: number }>> {
  if (!DAY.test(weekStart) || mondayOf(weekStart) !== weekStart) return fail("Choose a week (a Monday).", 400);
  const { data, error } = await rpc("menu_week_facts", { p_week_start: weekStart });
  if (error) return fail(error.message, /Only those/.test(error.message) ? 403 : 500);
  const facts = data as MenuWeekFacts;
  if (!facts.stock.length) return fail("No food is in stock, so there is nothing to plan from. Receive stock first.", 422);
  const answer = await askMenuModel(apiKey, buildSuggestPrompt(facts), "menu_week", SUGGEST_SCHEMA);
  if (!answer.ok) return fail(answer.error, answer.status);
  const valid = validateSuggestion(answer.data, facts);
  if (!valid.ok) return fail(valid.error, 422);
  let saved = 0;
  if (save) {
    const r = await rpc("save_menu_week", { p_week_start: weekStart, p_meals: valid.suggestion.meals, p_source: "ai" });
    if (r.error) return fail(r.error.message, 500);
    saved = Number(r.data ?? 0);
  }
  return { ok: true, result: { ...valid.suggestion, saved } };
}

export async function checkWeek(rpc: Rpc, apiKey: string, weekStart: string): Promise<JobResult<{ checked: number; alternatives: number }>> {
  if (!DAY.test(weekStart) || mondayOf(weekStart) !== weekStart) return fail("Choose a week (a Monday).", 400);
  const [facts, week] = await Promise.all([rpc("menu_week_facts", { p_week_start: weekStart }), rpc("menu_week", { p_week_start: weekStart })]);
  if (facts.error) return fail(facts.error.message, 403);
  if (week.error) return fail(week.error.message, 403);
  const f = facts.data as MenuWeekFacts;
  const rows = (week.data ?? []) as { id: string; date: string; meal_type: string; dish: string; ingredients: { itemId: string }[]; alternatives: { label: string; dish: string }[] }[];
  if (!rows.length) return fail("Nothing is planned for this week yet.", 422);
  const names = new Map(f.stock.map((s) => [s.item_id, s.name]));
  const planIds = new Set(rows.map((r) => r.id));
  const labels = new Set(f.instructions.map((i) => i.label));
  let checks: MealCheck[];
  if (!f.instructions.length) {
    // Nobody is under an instruction this week: every meal is fine as it is.
    checks = rows.map((r) => ({ plan_id: r.id, status: "ok" as const, notes: [], alternatives: [] }));
  } else {
    const meals = rows.map((r) => ({
      plan_id: r.id,
      date: r.date,
      meal_type: r.meal_type,
      dish: r.dish,
      ingredients: (r.ingredients ?? []).map((i) => ({ name: names.get(i.itemId) ?? "item" })),
      alternatives: (r.alternatives ?? []).map((a) => ({ label: a.label, dish: a.dish })),
    }));
    const answer = await askMenuModel(apiKey, buildCheckPrompt(f, meals), "menu_check", CHECK_SCHEMA);
    if (!answer.ok) return fail(answer.error, answer.status);
    checks = validateChecks(answer.data, planIds, labels);
    for (const id of planIds) if (!checks.some((c) => c.plan_id === id)) checks.push({ plan_id: id, status: "ok", notes: [], alternatives: [] });
  }
  const payload = Object.fromEntries(checks.map((c) => [c.plan_id, { status: c.status, notes: c.notes, alternatives: c.alternatives }]));
  const r = await rpc("set_menu_diet_check", { p_checks: payload });
  if (r.error) return fail(r.error.message, 500);
  return { ok: true, result: { checked: checks.length, alternatives: checks.filter((c) => c.status === "alternative").length } };
}
