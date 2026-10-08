"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, invalidateTables, useCollection } from "@/lib/data/collection-store";
import { donorsStore, type MutationResult } from "@/lib/hooks/use-donors-collection";
import type { DonorType } from "@/lib/types/donor";

/** A clean-up suggestion waiting for a donors editor (0083). */
export interface DonorSuggestion {
  id: string;
  donorId: string;
  kind: "format" | "merge" | "incomplete";
  proposed: { name?: string; salutation?: string | null; type?: DonorType; merge?: string };
  reason: string;
  source: "rule" | "ai";
  createdAt: string;
}

export const donorSuggestionsStore = createCollection<DonorSuggestion[]>({
  key: "ops.donor_suggestions",
  empty: [],
  tables: [{ schema: "ops", table: "donor_suggestions" }],
  fetch: async () => {
    const { data, error } = await createClient()
      .schema("ops")
      .from("donor_suggestions")
      .select("id, donor_id, kind, proposed, reason, source, created_at")
      .eq("status", "pending")
      .order("created_at");
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({
      id: r.id,
      donorId: r.donor_id,
      kind: r.kind,
      proposed: r.proposed ?? {},
      reason: r.reason ?? "",
      source: r.source,
      createdAt: r.created_at,
    }));
  },
});

async function call(fn: string, args: Record<string, unknown>): Promise<MutationResult> {
  const { error } = await createClient().schema("ops").rpc(fn, args);
  if (error) return { ok: false, error: error.message };
  await Promise.all([donorSuggestionsStore.refetch(), donorsStore.refetch()]);
  void invalidateTables([{ schema: "ops", table: "donor_pledges" }]);
  return { ok: true };
}

export function useDonorSuggestions() {
  const { data: suggestions, loading } = useCollection(donorSuggestionsStore);
  return {
    suggestions,
    loading,
    /** Apply as suggested, or with the editor's own name / salutation / type. */
    apply: (id: string, edits?: { name?: string; salutation?: string | null; type?: DonorType }) =>
      call("apply_donor_suggestion", { p_id: id, p_name: edits?.name ?? null, p_salutation: edits?.salutation ?? null, p_type: edits?.type ?? null }),
    reject: (id: string, note?: string) => call("reject_donor_suggestion", { p_id: id, p_note: note ?? null }),
    /** Fold `drop` into `keep` (either way round), with the reason recorded. */
    merge: (keep: string, drop: string, reason: string) => call("merge_donors", { p_keep: keep, p_drop: drop, p_reason: reason }),
  };
}
