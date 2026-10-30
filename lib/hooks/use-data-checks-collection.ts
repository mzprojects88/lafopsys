"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";

export type DataCheckStatus = "open" | "correct" | "fixed" | "explained" | "cleared";

/** One thing the Donation Tracker sync found inconsistent (0122), with the AI's one-line suggestion. */
export interface DataCheck {
  id: string;
  key: string;
  kind: string;
  severity: "error" | "warning" | "info";
  title: string;
  details: Record<string, unknown>;
  suggestion: string | null;
  firstSeen: string;
  lastSeen: string;
  status: DataCheckStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  note: string | null;
}

export type MutationResult = { ok: true } | { ok: false; error: string };

export const dataChecksStore = createCollection<DataCheck[]>({
  key: "ops.data_checks",
  empty: [],
  tables: [{ schema: "ops", table: "data_checks" }],
  fetch: async () => {
    const { data, error } = await createClient().schema("ops").from("data_checks").select("*").order("severity").order("first_seen", { ascending: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      id: String(r.id),
      key: String(r.key),
      kind: String(r.kind),
      severity: r.severity as DataCheck["severity"],
      title: String(r.title),
      details: (r.details as Record<string, unknown>) ?? {},
      suggestion: (r.suggestion as string | null) ?? null,
      firstSeen: String(r.first_seen),
      lastSeen: String(r.last_seen),
      status: r.status as DataCheckStatus,
      decidedBy: (r.decided_by as string | null) ?? null,
      decidedAt: (r.decided_at as string | null) ?? null,
      note: (r.note as string | null) ?? null,
    }));
  },
});

export function useDataChecks() {
  const { data: checks, loading } = useCollection(dataChecksStore);
  async function decide(id: string, status: Exclude<DataCheckStatus, "cleared">, note?: string): Promise<MutationResult> {
    const { error } = await createClient().schema("ops").rpc("decide_data_check", { p_id: id, p_status: status, p_note: note ?? null });
    if (error) return { ok: false, error: error.message };
    await dataChecksStore.refetch();
    return { ok: true };
  }
  return { checks, loading, decide };
}
