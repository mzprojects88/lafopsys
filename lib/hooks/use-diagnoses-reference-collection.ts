"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";
import { newId } from "@/lib/utils/id";

export type MutationResult = { ok: true } | { ok: false; error: string };
export type DiagnosisCategory = "cancer" | "thalassemia" | "other";

export interface DiagnosisRow {
  id: string;
  name: string;
  category: DiagnosisCategory;
}

/** Real ops.diagnoses -- category is a check-constrained enum, so this hook
 * (unlike use-reference-table-collection.ts's generic free-text meta column)
 * requires a valid category on insert. */
export const diagnosesReferenceStore = createCollection<DiagnosisRow[]>({
  key: "ops.diagnoses",
  empty: [],
  tables: [{ schema: "ops", table: "diagnoses" }],
  fetch: async () => {
    const supabase = createClient();
    const { data, error } = await supabase.schema("ops").from("diagnoses").select("id, name, category").order("name");
    if (error) throw new Error(error.message);
    return (data ?? []) as DiagnosisRow[];
  },
});

export function useDiagnosesReferenceData() {
  const { data: rows, loading } = useCollection(diagnosesReferenceStore);

  async function addRow(name: string, category: DiagnosisCategory): Promise<MutationResult> {
    const supabase = createClient();
    const { error } = await supabase.schema("ops").from("diagnoses").insert({ id: newId("diag"), name, category });
    if (error) return { ok: false, error: error.message };
    await diagnosesReferenceStore.refetch();
    return { ok: true };
  }

  async function deleteRow(id: string): Promise<MutationResult> {
    const supabase = createClient();
    const { error } = await supabase.schema("ops").from("diagnoses").delete().eq("id", id);
    if (error) return { ok: false, error: error.message };
    await diagnosesReferenceStore.refetch();
    return { ok: true };
  }

  return { rows, loading, addRow, deleteRow, refetch: diagnosesReferenceStore.refetch };
}
