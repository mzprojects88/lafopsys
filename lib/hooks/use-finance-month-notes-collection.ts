"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";
import type { MonthNote } from "@/lib/utils/finance-summary";

export type MutationResult = { ok: true } | { ok: false; error: string };

interface NoteRow {
  month: string;
  drivers: string;
  draft: string | null;
  draft_at: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  updated_by: string | null;
}

/**
 * ops.finance_month_notes (0033, 0113): each month's "Key monthly drivers" -- the confirmed
 * text in `drivers`, the app's latest suggestion in `draft`. A map keyed `yyyy-MM` because
 * the summary looks months up, never lists them.
 */
export const financeMonthNotesStore = createCollection<Record<string, MonthNote>>({
  key: "ops.finance_month_notes",
  empty: {},
  tables: [{ schema: "ops", table: "finance_month_notes" }],
  fetch: async () => {
    const { data, error } = await createClient().schema("ops").from("finance_month_notes").select("month, drivers, draft, draft_at, confirmed_by, confirmed_at, updated_by");
    if (error) throw new Error(error.message);
    return Object.fromEntries(
      ((data ?? []) as NoteRow[]).map((r) => [r.month, { month: r.month, drivers: r.drivers, draft: r.draft, draftAt: r.draft_at, confirmedBy: r.confirmed_by, confirmedAt: r.confirmed_at }])
    );
  },
});

export function useFinanceMonthNotes() {
  const { data: notes, loading, error } = useCollection(financeMonthNotesStore);
  const drivers = React.useMemo(() => Object.fromEntries(Object.values(notes).map((n) => [n.month, n.drivers])), [notes]);

  /** The one door for approving a month's text (ops.confirm_month_drivers): who and when are recorded in the database. */
  async function confirm(month: string, text: string): Promise<MutationResult> {
    const { error } = await createClient().schema("ops").rpc("confirm_month_drivers", { p_month: month, p_text: text });
    if (error) return { ok: false, error: error.message };
    await financeMonthNotesStore.refetch();
    return { ok: true };
  }

  /** Ask the app for a (new) draft of the month. */
  async function suggest(month: string): Promise<MutationResult> {
    try {
      const r = (await (await fetch("/api/finance/month-drivers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ month }) })).json()) as { ok: boolean; error?: string };
      if (!r.ok) return { ok: false, error: r.error ?? "Couldn't draft the summary." };
    } catch {
      return { ok: false, error: "Couldn't reach the server." };
    }
    await financeMonthNotesStore.refetch();
    return { ok: true };
  }

  return { notes, drivers, loading, error, confirm, suggest, refetch: financeMonthNotesStore.refetch };
}
