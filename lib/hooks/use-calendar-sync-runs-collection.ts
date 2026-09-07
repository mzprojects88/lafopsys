"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";

export interface CalendarSyncRun {
  id: string;
  startedAt: string;
  finishedAt?: string;
  status: "running" | "success" | "unchanged" | "failed";
  trigger: "cron" | "manual";
  triggeredBy?: string;
  rowsSeen: number;
  inserted: number;
  updated: number;
  removed: number;
  restored: number;
  collisions: number;
  duplicates: number;
  error?: string;
}

interface RunRow {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: CalendarSyncRun["status"];
  trigger: CalendarSyncRun["trigger"];
  triggered_by: string | null;
  rows_seen: number;
  inserted: number;
  updated: number;
  removed: number;
  restored: number;
  collisions: number;
  duplicates: number;
  error: string | null;
}

function toRun(r: RunRow): CalendarSyncRun {
  return {
    id: r.id,
    startedAt: r.started_at,
    finishedAt: r.finished_at ?? undefined,
    status: r.status,
    trigger: r.trigger,
    triggeredBy: r.triggered_by ?? undefined,
    rowsSeen: r.rows_seen,
    inserted: r.inserted,
    updated: r.updated,
    removed: r.removed,
    restored: r.restored,
    collisions: r.collisions,
    duplicates: r.duplicates,
    error: r.error ?? undefined,
  };
}

/** The last fifty checks of the Google Sheet (0034), newest first. Written
 * only by the sync route; realtime keeps the status line current while a
 * run is in flight. */
export const calendarSyncRunsStore = createCollection<CalendarSyncRun[]>({
  key: "ops.calendar_sync_runs",
  empty: [],
  tables: [{ schema: "ops", table: "calendar_sync_runs" }],
  fetch: async () => {
    const { data, error } = await createClient()
      .schema("ops")
      .from("calendar_sync_runs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return ((data ?? []) as RunRow[]).map(toRun);
  },
});

export function useCalendarSyncRuns() {
  const { data: runs, loading, error } = useCollection(calendarSyncRunsStore);
  return { runs, loading, error, refetch: calendarSyncRunsStore.refetch };
}

/** A run that changed something -- what "last change" means on the status line. */
export function runChangedSomething(run: CalendarSyncRun): boolean {
  return run.status === "success" && run.inserted + run.updated + run.removed + run.restored > 0;
}
