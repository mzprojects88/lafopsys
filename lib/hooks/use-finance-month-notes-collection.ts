"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";
import { useRole } from "@/context/role-provider";

export type MutationResult = { ok: true } | { ok: false; error: string };

interface NoteRow {
  month: string;
  drivers: string;
  updated_by: string | null;
  updated_at: string;
}

/**
 * ops.finance_month_notes (0033): the "Key Monthly Drivers" paragraph for
 * each month, keyed `yyyy-MM`. Exposed as a map because the summary looks
 * notes up by month, never lists them.
 */
export const financeMonthNotesStore = createCollection<Record<string, string>>({
  key: "ops.finance_month_notes",
  empty: {},
  tables: [{ schema: "ops", table: "finance_month_notes" }],
  fetch: async () => {
    const { data, error } = await createClient().schema("ops").from("finance_month_notes").select("month, drivers, updated_by, updated_at");
    if (error) throw new Error(error.message);
    return Object.fromEntries(((data ?? []) as NoteRow[]).map((r) => [r.month, r.drivers]));
  },
});

export function useFinanceMonthNotes() {
  const { data: notes, loading, error } = useCollection(financeMonthNotesStore);
  const { staffId } = useRole();

  async function upsertNote(month: string, drivers: string): Promise<MutationResult> {
    const { error } = await createClient()
      .schema("ops")
      .from("finance_month_notes")
      .upsert({ month, drivers: drivers.trim(), updated_by: staffId ?? null }, { onConflict: "month" });
    if (error) return { ok: false, error: error.message };
    await financeMonthNotesStore.refetch();
    return { ok: true };
  }

  return { notes, loading, error, upsertNote, refetch: financeMonthNotesStore.refetch };
}
