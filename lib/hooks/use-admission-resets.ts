"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";

/** One row per day the morning reset ran (0089). */
export interface AdmissionReset {
  day: string;
  ranAt: string;
  checkedOut: number;
}

export const admissionResetsStore = createCollection<AdmissionReset[]>({
  key: "ops.admission_resets",
  empty: [],
  tables: [{ schema: "ops", table: "admission_resets" }],
  fetch: async () => {
    const { data, error } = await createClient().schema("ops").from("admission_resets").select("day, ran_at, checked_out").order("day", { ascending: false }).limit(14);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({ day: r.day as string, ranAt: r.ran_at as string, checkedOut: Number(r.checked_out) }));
  },
});

export function useAdmissionResets() {
  const { data: resets, loading } = useCollection(admissionResetsStore);
  return { resets, loading };
}
