"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";
import { todayIso } from "@/lib/utils/date";

export const MEALS = ["breakfast", "lunch", "dinner"] as const;
export type Meal = (typeof MEALS)[number];
export type MutationResult = { ok: true } | { ok: false; error: string };

/** Today's meals served per patient and carer (0095): "patientId|meal" keys. */
export const mealsServedStore = createCollection<Set<string>>({
  key: "ops.meals_served",
  empty: new Set(),
  tables: [{ schema: "ops", table: "meals_served" }],
  fetch: async () => {
    const { data, error } = await createClient().schema("ops").from("meals_served").select("patient_id, meal").eq("date", todayIso());
    if (error) throw new Error(error.message);
    return new Set((data ?? []).map((r) => `${r.patient_id}|${r.meal}`));
  },
});

export function useMealsServed() {
  const { data: served } = useCollection(mealsServedStore);

  /** Ticks or unticks today's meal; who and when are stamped by the database. */
  async function toggle(patientId: string, meal: Meal): Promise<MutationResult> {
    const ops = createClient().schema("ops").from("meals_served");
    const { error } = served.has(`${patientId}|${meal}`)
      ? await ops.delete().eq("patient_id", patientId).eq("date", todayIso()).eq("meal", meal)
      : await ops.insert({ patient_id: patientId, date: todayIso(), meal });
    await mealsServedStore.refetch();
    return error ? { ok: false, error: error.message } : { ok: true };
  }

  return { isServed: (patientId: string, meal: Meal) => served.has(`${patientId}|${meal}`), toggle };
}
