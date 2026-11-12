"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection } from "@/lib/data/collection-store";

export interface PunchDeletion {
  id: string;
  /** Deleted (0141) or its time changed (0146). */
  action: "deleted" | "edited";
  punchId: string;
  staffId: string | null;
  punchedAt: string;
  punchType: string;
  /** The new time of a changed punch. */
  newPunchedAt: string | null;
  reason: string;
  deletedBy: string | null;
  deletedAt: string;
}

/** The punch log, latest 200: punches deleted as mistakes (0141) and times changed (0146), a copy of each as it was,
 * with who and why. Those who manage punches read it all, everyone else the changes to their own (RLS). */
export const punchDeletionsStore = createCollection<PunchDeletion[]>({
  key: "ops.time_punch_deletions",
  empty: [],
  tables: [{ schema: "ops", table: "time_punch_deletions" }],
  fetch: async () => {
    const { data, error } = await createClient()
      .schema("ops")
      .from("time_punch_deletions")
      .select("id, action, punch_id, staff_id, punched_at, new_punched_at, punch, reason, deleted_by, deleted_at")
      .order("deleted_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({
      id: String(r.id),
      action: r.action === "edited" ? "edited" : "deleted",
      punchId: String(r.punch_id),
      staffId: r.staff_id as string | null,
      punchedAt: String(r.punched_at),
      punchType: String((r.punch as { punch_type?: string } | null)?.punch_type ?? ""),
      newPunchedAt: (r.new_punched_at as string | null) ?? null,
      reason: String(r.reason),
      deletedBy: r.deleted_by as string | null,
      deletedAt: String(r.deleted_at),
    }));
  },
});
