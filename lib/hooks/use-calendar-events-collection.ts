"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";
import { useRole } from "@/context/role-provider";
import type { CalendarEvent } from "@/lib/types/calendar";

export type MutationResult = { ok: true } | { ok: false; error: string };

interface CalendarEventRow {
  id: string;
  date: string;
  time: string | null;
  title: string;
  venue: string | null;
  officer_on_duty: string | null;
  officer_staff_id: string | null;
  staff_needed: string | null;
  booked_by: string | null;
  contact_info: string | null;
  remarks: string | null;
  is_holiday: boolean;
  source: "app" | "sheet";
  sheet_removed_at: string | null;
  created_by: string | null;
  updated_by: string | null;
}

function toCalendarEvent(row: CalendarEventRow): CalendarEvent {
  return {
    id: row.id,
    date: row.date,
    time: row.time ?? undefined,
    title: row.title,
    venue: row.venue ?? undefined,
    officerOnDuty: row.officer_on_duty ?? undefined,
    officerStaffId: row.officer_staff_id ?? undefined,
    staffNeeded: row.staff_needed ?? undefined,
    bookedBy: row.booked_by ?? undefined,
    contactInfo: row.contact_info ?? undefined,
    remarks: row.remarks ?? undefined,
    isHoliday: row.is_holiday,
    source: row.source,
    sheetRemovedAt: row.sheet_removed_at ?? undefined,
    createdBy: row.created_by ?? undefined,
    updatedBy: row.updated_by ?? undefined,
  };
}

/** What the dialog sends; the row's own bookkeeping columns are set here. */
export type CalendarEventInput = Omit<CalendarEvent, "id" | "createdBy" | "updatedBy" | "officerStaffId" | "source" | "sheetRemovedAt">;

function toRow(input: CalendarEventInput) {
  const text = (v: string | undefined) => (v && v.trim() ? v.trim() : null);
  return {
    date: input.date,
    time: text(input.time),
    title: input.title.trim(),
    venue: text(input.venue),
    officer_on_duty: text(input.officerOnDuty),
    staff_needed: text(input.staffNeeded),
    booked_by: text(input.bookedBy),
    contact_info: text(input.contactInfo),
    remarks: text(input.remarks),
    is_holiday: input.isHoliday,
  };
}

/**
 * The master calendar, from ops.calendar_events (0032). Realtime keeps every
 * open copy in step, so an event booked on one phone appears on the wall
 * display without a reload. Ordered by date then time so the list reads
 * top-to-bottom the way the sheet did.
 */
export const calendarEventsStore = createCollection<CalendarEvent[]>({
  key: "ops.calendar_events",
  empty: [],
  tables: [{ schema: "ops", table: "calendar_events" }],
  fetch: async () => {
    const { data, error } = await createClient()
      .schema("ops")
      .from("calendar_events")
      .select("*")
      // Events the sheet has dropped stay in the table for the sync log and
      // for restoring; every calendar view leaves them out here, not in RLS.
      .is("sheet_removed_at", null)
      .order("date", { ascending: true })
      .order("time", { ascending: true, nullsFirst: true });
    if (error) throw new Error(error.message);
    return ((data ?? []) as CalendarEventRow[]).map(toCalendarEvent);
  },
});

export function useCalendarEventsData() {
  const { data: events, loading, error } = useCollection(calendarEventsStore);
  const { staffId } = useRole();

  async function addEvent(input: CalendarEventInput): Promise<MutationResult> {
    const { error } = await createClient()
      .schema("ops")
      .from("calendar_events")
      .insert({ ...toRow(input), source: "app", created_by: staffId ?? null, updated_by: staffId ?? null });
    if (error) return { ok: false, error: error.message };
    await calendarEventsStore.refetch();
    return { ok: true };
  }

  async function updateEvent(id: string, input: CalendarEventInput): Promise<MutationResult> {
    const { error } = await createClient()
      .schema("ops")
      .from("calendar_events")
      .update({ ...toRow(input), updated_by: staffId ?? null })
      .eq("id", id);
    if (error) return { ok: false, error: error.message };
    await calendarEventsStore.refetch();
    return { ok: true };
  }

  async function deleteEvent(id: string): Promise<MutationResult> {
    const { error } = await createClient().schema("ops").from("calendar_events").delete().eq("id", id);
    if (error) return { ok: false, error: error.message };
    await calendarEventsStore.refetch();
    return { ok: true };
  }

  return { events, loading, error, addEvent, updateEvent, deleteEvent, refetch: calendarEventsStore.refetch };
}
