"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";
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
export function useBudgetLinesData() {
  const [budgetLines, setBudgetLines] = React.useState<BudgetLine[]>([]);
  const [loading, setLoading] = React.useState(true);

  const refetch = React.useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.schema("ops").from("budget_lines").select("*").order("month", { ascending: false });
    setBudgetLines((data ?? []).map(toBudgetLine));
    setLoading(false);
  }, []);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from Supabase, an external system
    refetch();
  }, [refetch]);

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
    await refetch();
    return { ok: true };
  }

  return { budgetLines, loading, addBudgetLine, refetch };
}
