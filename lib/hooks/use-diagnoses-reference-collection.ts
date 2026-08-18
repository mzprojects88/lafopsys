"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";
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
export function useDiagnosesReferenceData() {
  const [rows, setRows] = React.useState<DiagnosisRow[]>([]);
  const [loading, setLoading] = React.useState(true);

  const refetch = React.useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.schema("ops").from("diagnoses").select("id, name, category").order("name");
    setRows((data ?? []) as DiagnosisRow[]);
    setLoading(false);
  }, []);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from Supabase, an external system
    refetch();
  }, [refetch]);

  async function addRow(name: string, category: DiagnosisCategory): Promise<MutationResult> {
    const supabase = createClient();
    const { error } = await supabase.schema("ops").from("diagnoses").insert({ id: newId("diag"), name, category });
    if (error) return { ok: false, error: error.message };
    await refetch();
    return { ok: true };
  }

  async function deleteRow(id: string): Promise<MutationResult> {
    const supabase = createClient();
    const { error } = await supabase.schema("ops").from("diagnoses").delete().eq("id", id);
    if (error) return { ok: false, error: error.message };
    await refetch();
    return { ok: true };
  }

  return { rows, loading, addRow, deleteRow, refetch };
}
