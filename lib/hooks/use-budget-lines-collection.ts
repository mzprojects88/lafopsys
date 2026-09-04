"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";
import type { BudgetLine } from "@/lib/types/finance";

export type MutationResult = { ok: true } | { ok: false; error: string };

interface BudgetLineRow {
  id: string;
  program_id: string;
  month: string;
  budgeted: number;
  actual: number;
}

function toBudgetLine(row: BudgetLineRow): BudgetLine {
  return { id: row.id, programId: row.program_id, month: row.month, budgeted: row.budgeted, actual: row.actual };
}

/** ops.budget_lines starts empty -- mock budgeted/actual amounts were entirely
 * rng-fabricated, not real LAF budget data. Staff add real budget lines here. */
export const budgetLinesStore = createCollection<BudgetLine[]>({
  key: "ops.budget_lines",
  empty: [],
  tables: [{ schema: "ops", table: "budget_lines" }],
  fetch: async () => {
    const supabase = createClient();
    const { data, error } = await supabase.schema("ops").from("budget_lines").select("*").order("month", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map(toBudgetLine);
  },
});

export function useBudgetLinesData() {
  const { data: budgetLines, loading } = useCollection(budgetLinesStore);

  async function addBudgetLine(line: Omit<BudgetLine, "id">): Promise<MutationResult> {
    const supabase = createClient();
    const { error } = await supabase.schema("ops").from("budget_lines").insert({
      id: crypto.randomUUID(),
      program_id: line.programId,
      month: line.month,
      budgeted: line.budgeted,
      actual: line.actual,
    });
    if (error) return { ok: false, error: error.message };
    await budgetLinesStore.refetch();
    return { ok: true };
  }

  return { budgetLines, loading, addBudgetLine, refetch: budgetLinesStore.refetch };
}
