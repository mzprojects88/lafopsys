"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";
import type { MenuMeal } from "@/lib/utils/menu-week-ui";

export type Result<T = void> = { ok: true; value: T } | { ok: false; error: string };

/** Who each "Person N" is, for those who see clinical detail. */
export type MenuPeople = Record<string, { name: string; applies_to: "patient" | "carer"; instruction: string }>;

interface WeekRow {
  id: string;
  date: string;
  meal_type: string;
  status: MenuMeal["status"];
  servings: number;
  dish: string;
  recipe_id: string;
  ingredients: MenuMeal["ingredients"] | null;
  source: MenuMeal["source"];
  alternatives: MenuMeal["alternatives"] | null;
  diet_check: MenuMeal["dietCheck"];
  notes: string | null;
  approved_by: string | null;
  review_note: string | null;
  people: MenuPeople | null;
}

/** A meal as save_menu_week takes it. */
export interface MealInput {
  date: string;
  meal_type: string;
  dish: string;
  recipe_id?: string | null;
  ingredients: { itemId: string; perServing?: number }[];
  servings: number;
  notes?: string;
  alternatives?: MenuMeal["alternatives"];
}

const inv = () => createClient().schema("inventory");

/**
 * The week's menu (0068): one record in inventory.menu_plans, read and written through the
 * database's functions, so LAF Inventory and the Operating System see the same week.
 */
export function useMenuWeek(weekStart: string) {
  const [state, setState] = React.useState<{ key: string; meals?: MenuMeal[]; people?: MenuPeople; error?: string } | null>(null);
  const [version, setVersion] = React.useState(0);
  const key = `${weekStart}_${version}`;

  React.useEffect(() => {
    let cancelled = false;
    inv()
      .rpc("menu_week", { p_week_start: weekStart })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) return void setState({ key, error: error.message });
        const rows = (data ?? []) as WeekRow[];
        setState({
          key,
          people: rows[0]?.people ?? {},
          meals: rows.map((r) => ({
            id: r.id,
            date: r.date,
            mealType: r.meal_type,
            status: r.status,
            servings: r.servings,
            dish: r.dish,
            recipeId: r.recipe_id,
            ingredients: r.ingredients ?? [],
            source: r.source,
            alternatives: r.alternatives ?? [],
            dietCheck: r.diet_check,
            notes: r.notes ?? "",
            approvedBy: r.approved_by,
            reviewNote: r.review_note,
          })),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [weekStart, key]);

  const reload = React.useCallback(() => setVersion((v) => v + 1), []);

  const saveMeals = React.useCallback(
    async (meals: MealInput[]): Promise<Result<number>> => {
      const { data, error } = await inv().rpc("save_menu_week", { p_week_start: weekStart, p_meals: meals, p_source: "manual" });
      if (error) return { ok: false, error: error.message };
      reload();
      return { ok: true, value: Number(data ?? 0) };
    },
    [weekStart, reload]
  );

  const setStatus = React.useCallback(
    async (status: "pending_nutritionist" | "approved" | "rejected", note?: string): Promise<Result<number>> => {
      const { data, error } = await inv().rpc("set_menu_week_status", { p_week_start: weekStart, p_status: status, p_note: note ?? null });
      if (error) return { ok: false, error: error.message };
      reload();
      return { ok: true, value: Number(data ?? 0) };
    },
    [weekStart, reload]
  );

  const call = React.useCallback(
    async <T,>(path: string, body: Record<string, unknown>): Promise<Result<T>> => {
      try {
        const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ weekStart, ...body }) });
        const json = (await res.json().catch(() => ({}))) as T & { error?: string };
        if (!res.ok) return { ok: false, error: json.error ?? "Couldn't reach the AI." };
        reload();
        return { ok: true, value: json };
      } catch {
        return { ok: false, error: "Couldn't reach the server." };
      }
    },
    [weekStart, reload]
  );

  const ready = state?.key === key;
  return {
    meals: ready ? state.meals : undefined,
    people: ready ? (state.people ?? {}) : {},
    error: ready ? state.error : undefined,
    loading: !ready,
    reload,
    saveMeals,
    setStatus,
    suggest: (preview = false) => call<{ summary: string; shopping: { name: string; note: string }[]; saved: number }>("/api/menu/suggest-week", { preview }),
    check: () => call<{ checked: number; alternatives: number }>("/api/menu/check-week", {}),
  };
}

/** The dietary rules the AI follows (inventory.app_settings.dietary_rules), and who may change them. */
export function useDietaryRules() {
  const [rules, setRules] = React.useState<string | null>(null);
  const load = React.useCallback(async () => {
    const { data } = await inv().from("app_settings").select("dietary_rules").maybeSingle();
    setRules((data?.dietary_rules as string | null) ?? "");
  }, []);
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read from the database on mount
    void load();
  }, [load]);
  const save = React.useCallback(
    async (text: string): Promise<Result> => {
      const { error } = await inv().rpc("set_dietary_rules", { p_rules: text });
      if (error) return { ok: false, error: error.message };
      await load();
      return { ok: true, value: undefined };
    },
    [load]
  );
  return { rules, save };
}

/** The approved (or planned) dish for a date and meal, for the Meals page and Kitchen Draw. */
export async function plannedMeal(date: string, mealType: string): Promise<{ dish: string; servings: number; status: string; ingredients: { itemId: string; perServing?: number }[] } | null> {
  if (!mealType) return null;
  const { data } = await inv().from("menu_plans").select("servings, status, recipes(name, ingredients)").eq("date", date).eq("meal_type", mealType).maybeSingle();
  if (!data) return null;
  const raw = data.recipes as unknown;
  const r = (Array.isArray(raw) ? raw[0] : raw) as { name: string; ingredients: { itemId: string; perServing?: number }[] } | null | undefined;
  return r ? { dish: r.name, servings: data.servings, status: data.status, ingredients: r.ingredients ?? [] } : null;
}
