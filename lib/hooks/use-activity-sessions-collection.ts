"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";
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

export function useActivitySessionsData() {
  const [sessions, setSessions] = React.useState<ActivitySession[]>([]);
  const [loading, setLoading] = React.useState(true);

  const refetch = React.useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.schema("ops").from("activity_sessions").select("*").order("date", { ascending: false });
    setSessions((data ?? []).map(toActivitySession));
    setLoading(false);
  }, []);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from Supabase, an external system
    refetch();
  }, [refetch]);

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
    await refetch();
    return { ok: true };
  }

  return { sessions, loading, addSession, refetch };
}
