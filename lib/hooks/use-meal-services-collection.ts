"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";
import type { MealService } from "@/lib/types/house-ops";

export type MutationResult = { ok: true } | { ok: false; error: string };

interface MealServiceRow {
  id: string;
  date: string;
  meal_type: MealService["mealType"];
  headcount: number;
  cost_per_head: number | null;
  meal_service_exceptions: { patient_id: string; reason: string }[] | null;
}

function toMealService(row: MealServiceRow): MealService {
  return {
    id: row.id,
    date: row.date,
    mealType: row.meal_type,
    headcount: row.headcount,
    costPerHead: row.cost_per_head ?? undefined,
    exceptions: (row.meal_service_exceptions ?? []).map((e) => ({ patientId: e.patient_id, reason: e.reason })),
  };
}

export function useMealServicesData() {
  const [meals, setMeals] = React.useState<MealService[]>([]);
  const [loading, setLoading] = React.useState(true);

  const refetch = React.useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .schema("ops")
      .from("meal_services")
      .select("*, meal_service_exceptions(patient_id, reason)")
      .order("date", { ascending: false });
    setMeals((data ?? []).map(toMealService));
    setLoading(false);
  }, []);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from Supabase, an external system
    refetch();
  }, [refetch]);

  /** Adds an exception for a staff-chosen patient (never a random pick) and
   * decrements the headcount by one, matching the prior demo behavior's intent
   * without its bug. */
  async function addException(mealServiceId: string, patientId: string, reason: string, currentHeadcount: number): Promise<MutationResult> {
    const supabase = createClient();
    const { error: exceptionError } = await supabase
      .schema("ops")
      .from("meal_service_exceptions")
      .insert({ meal_service_id: mealServiceId, patient_id: patientId, reason });
    if (exceptionError) return { ok: false, error: exceptionError.message };

    const { error: headcountError } = await supabase
      .schema("ops")
      .from("meal_services")
      .update({ headcount: Math.max(0, currentHeadcount - 1) })
      .eq("id", mealServiceId);
    if (headcountError) return { ok: false, error: headcountError.message };

    await refetch();
    return { ok: true };
  }

  return { meals, loading, addException, refetch };
}
