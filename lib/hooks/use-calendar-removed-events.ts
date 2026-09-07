"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";
import type { CalendarEvent } from "@/lib/types/calendar";

interface RemovedRow {
  id: string;
  date: string;
  time: string | null;
  title: string;
  venue: string | null;
  officer_on_duty: string | null;
  is_holiday: boolean;
  source: "app" | "sheet";
  sheet_removed_at: string;
}

export type RemovedCalendarEvent = Pick<CalendarEvent, "id" | "date" | "time" | "title" | "venue" | "officerOnDuty" | "isHoliday" | "source"> & {
  sheetRemovedAt: string;
};

/** Sheet events the sync has hidden because the sheet dropped them (0034).
 * The one place they are visible, so an accident can be undone. */
export const calendarRemovedEventsStore = createCollection<RemovedCalendarEvent[]>({
  key: "ops.calendar_events:removed",
  empty: [],
  tables: [{ schema: "ops", table: "calendar_events" }],
  fetch: async () => {
    const { data, error } = await createClient()
      .schema("ops")
      .from("calendar_events")
      .select("id, date, time, title, venue, officer_on_duty, is_holiday, source, sheet_removed_at")
      .not("sheet_removed_at", "is", null)
      .order("sheet_removed_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return ((data ?? []) as RemovedRow[]).map((r) => ({
      id: r.id,
      date: r.date,
      time: r.time ?? undefined,
      title: r.title,
      venue: r.venue ?? undefined,
      officerOnDuty: r.officer_on_duty ?? undefined,
      isHoliday: r.is_holiday,
      source: r.source,
      sheetRemovedAt: r.sheet_removed_at,
    }));
  },
});

export function useCalendarRemovedEvents() {
  const { data: removed, loading, error } = useCollection(calendarRemovedEventsStore);
  return { removed, loading, error, refetch: calendarRemovedEventsStore.refetch };
}
