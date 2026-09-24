"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";
import { timeEntriesStore } from "@/lib/hooks/use-time-entries-collection";

export interface CorrectionRequest {
  id: string;
  staffId: string;
  timeEntryId: string;
  kind: "missed_clock_out" | "missed_clock_in" | "wrong_time";
  punchType: "clock_in" | "clock_out";
  requestedAt: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
}

interface Row {
  id: string;
  staff_id: string;
  time_entry_id: string;
  kind: CorrectionRequest["kind"];
  punch_type: CorrectionRequest["punchType"];
  requested_at: string;
  reason: string;
  status: CorrectionRequest["status"];
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
}

/** DTR correction requests (0061): your own, or everyone's for admins and HR (RLS decides). */
export const correctionRequestsStore = createCollection<CorrectionRequest[]>({
  key: "ops.dtr_correction_requests",
  empty: [],
  tables: [{ schema: "ops", table: "dtr_correction_requests" }],
  fetch: async () => {
    const { data, error } = await createClient().schema("ops").from("dtr_correction_requests").select("*").order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as Row[]).map((r) => ({
      id: r.id,
      staffId: r.staff_id,
      timeEntryId: r.time_entry_id,
      kind: r.kind,
      punchType: r.punch_type,
      requestedAt: r.requested_at,
      reason: r.reason,
      status: r.status,
      decidedBy: r.decided_by,
      decidedAt: r.decided_at,
      decisionNote: r.decision_note,
      createdAt: r.created_at,
    }));
  },
});

export function useCorrectionRequests() {
  const { data: requests, loading } = useCollection(correctionRequestsStore);

  /** "I forgot to clock out; I left at ..." -- a request for admins and HR, and the day stops counting as clocked in. */
  async function reportMissedClockOut(entryId: string, leftAt: Date, reason: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const { error } = await createClient()
      .schema("ops")
      .rpc("report_missed_clock_out", { p_entry_id: entryId, p_left_at: leftAt.toISOString(), p_reason: reason });
    if (error) return { ok: false, error: error.message };
    await Promise.all([correctionRequestsStore.refetch(), timeEntriesStore.refetch()]);
    return { ok: true };
  }

  return { requests, loading, reportMissedClockOut };
}
