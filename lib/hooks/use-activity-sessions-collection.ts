"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";
import type { ActivitySession } from "@/lib/types/house-ops";

export type MutationResult = { ok: true } | { ok: false; error: string };

interface ActivitySessionRow {
  id: string;
  date: string;
  title: string;
  participants: number;
  volunteer_count: number;
  facilitator: string | null;
  hours: number;
}

function toActivitySession(row: ActivitySessionRow): ActivitySession {
  return {
    id: row.id,
    date: row.date,
    title: row.title,
    participants: row.participants,
    volunteerCount: row.volunteer_count,
    facilitator: row.facilitator ?? "",
    hours: row.hours,
  };
}

export const activitySessionsStore = createCollection<ActivitySession[]>({
  key: "ops.activity_sessions",
  empty: [],
  tables: [{ schema: "ops", table: "activity_sessions" }],
  fetch: async () => {
    const supabase = createClient();
    const { data, error } = await supabase.schema("ops").from("activity_sessions").select("*").order("date", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map(toActivitySession);
  },
});

export function useActivitySessionsData() {
  const { data: sessions, loading } = useCollection(activitySessionsStore);

  async function addSession(session: Omit<ActivitySession, "id">): Promise<MutationResult> {
    const supabase = createClient();
    const { error } = await supabase.schema("ops").from("activity_sessions").insert({
      id: crypto.randomUUID(),
      date: session.date,
      title: session.title,
      participants: session.participants,
      volunteer_count: session.volunteerCount,
      facilitator: session.facilitator || null,
      hours: session.hours,
    });
    if (error) return { ok: false, error: error.message };
    await activitySessionsStore.refetch();
    return { ok: true };
  }

  return { sessions, loading, addSession, refetch: activitySessionsStore.refetch };
}
