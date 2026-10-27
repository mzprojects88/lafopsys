"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";
import type { BudgetLine } from "@/lib/types/finance";

export type MutationResult = { ok: true } | { ok: false; error: string };

interface BudgetLineRow {
  id: string;
  program_id: string | null;
  purpose: string | null;
  month: string;
  budgeted: number | string;
}

/** ops.budget_lines (0011, 0115): a month's budget per expense purpose. The actual is never
 * stored -- the Budget page adds up that month's bank debits with the purpose. */
export const budgetLinesStore = createCollection<BudgetLine[]>({
  key: "ops.budget_lines",
  empty: [],
  tables: [{ schema: "ops", table: "budget_lines" }],
  fetch: async () => {
    const { data, error } = await createClient().schema("ops").from("budget_lines").select("id, program_id, purpose, month, budgeted").order("month", { ascending: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as BudgetLineRow[]).map((r) => ({ id: r.id, programId: r.program_id, purpose: r.purpose, month: r.month, budgeted: Number(r.budgeted) }));
  },
});

export function useBudgetLinesData() {
  const { data: budgetLines, loading } = useCollection(budgetLinesStore);

  /** Sets the month's budget for several purposes at once (one save for "copy last month"). */
  async function setBudgets(month: string, amounts: Record<string, number>): Promise<MutationResult> {
    const rows = Object.entries(amounts).map(([purpose, budgeted]) => ({ purpose, month, budgeted }));
    if (!rows.length) return { ok: true };
    const { error } = await createClient().schema("ops").from("budget_lines").upsert(rows, { onConflict: "purpose,month" });
    if (error) return { ok: false, error: error.message };
    await budgetLinesStore.refetch();
    return { ok: true };
  }

  return { budgetLines, loading, setBudgets, refetch: budgetLinesStore.refetch };
}
