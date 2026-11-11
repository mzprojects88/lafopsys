"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection } from "@/lib/data/collection-store";

export interface PunchDeletion {
  id: string;
  staffId: string | null;
  punchedAt: string;
  punchType: string;
  reason: string;
  deletedBy: string | null;
  deletedAt: string;
}

/** Punches the Super Admin deleted as mistakes (0141), the latest 200: a copy of each, with who and why. HR and
 * the Super Admin read it (RLS); everyone else gets none. */
export const punchDeletionsStore = createCollection<PunchDeletion[]>({
  key: "ops.time_punch_deletions",
  empty: [],
  tables: [{ schema: "ops", table: "time_punch_deletions" }],
  fetch: async () => {
    const { data, error } = await createClient()
      .schema("ops")
      .from("time_punch_deletions")
      .select("id, staff_id, punched_at, punch, reason, deleted_by, deleted_at")
      .order("deleted_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({
      id: String(r.id),
      staffId: r.staff_id as string | null,
      punchedAt: String(r.punched_at),
      punchType: String((r.punch as { punch_type?: string } | null)?.punch_type ?? ""),
      reason: String(r.reason),
      deletedBy: r.deleted_by as string | null,
      deletedAt: String(r.deleted_at),
    }));
  },
});
