"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";
import type { BookingPlan, BookingPlanItem, PlanStatus } from "@/lib/types/booking";
import type { MutationResult } from "@/lib/hooks/use-bookings-collection";
import { sameWeekdayIn } from "@/lib/utils/booking";

const booking = () => createClient().schema("booking");
const text = (v: unknown) => (typeof v === "string" ? v : "");
const clean = (v: string) => v.replace(/\s+/g, " ").trim();

export type PlanItemInput = Pick<BookingPlanItem, "activity" | "purpose" | "participants" | "materials" | "onDate" | "start" | "end">;

/** The monthly Activity Plans and their activities (0172). A plan covers one place for one month, from the 1st to
 * the last day; once NCH approved it, its activities are offered first on the booking page for that month. */
export const bookingPlansStore = createCollection<{ plans: BookingPlan[]; items: BookingPlanItem[] }>({
  key: "booking.plans",
  empty: { plans: [], items: [] },
  tables: [
    { schema: "booking", table: "plans" },
    { schema: "booking", table: "plan_items" },
  ],
  fetch: async () => {
    const [p, i] = await Promise.all([
      booking().from("plans").select("id, place_id, month, status, submitted_on, approved_on, approved_by, notes").order("month", { ascending: false }),
      booking().from("plan_items").select("id, plan_id, activity, purpose, participants, materials, on_date, start_time, end_time, sort").order("on_date").order("start_time").order("activity"),
    ]);
    const error = p.error ?? i.error;
    if (error) throw new Error(error.message);
    return {
      plans: (p.data ?? []).map((r) => ({
        id: r.id as string,
        placeId: r.place_id as string,
        month: text(r.month).slice(0, 7),
        status: r.status as PlanStatus,
        submittedOn: (r.submitted_on as string | null) ?? null,
        approvedOn: (r.approved_on as string | null) ?? null,
        approvedBy: text(r.approved_by),
        notes: text(r.notes),
      })),
      items: (i.data ?? []).map((r) => ({
        id: r.id as string,
        planId: r.plan_id as string,
        activity: text(r.activity),
        purpose: text(r.purpose),
        participants: text(r.participants),
        materials: text(r.materials),
        onDate: text(r.on_date),
        start: text(r.start_time).slice(0, 5),
        end: text(r.end_time).slice(0, 5),
        sort: Number(r.sort ?? 0),
      })),
    };
  },
});

export function useBookingPlans() {
  const { data, loading, error } = useCollection(bookingPlansStore);
  const done = async (e: { message: string } | null): Promise<MutationResult> => {
    await bookingPlansStore.refetch();
    return e ? { ok: false, error: e.message } : { ok: true };
  };
  const itemRow = (i: PlanItemInput) => ({ activity: clean(i.activity), purpose: clean(i.purpose), participants: clean(i.participants), materials: clean(i.materials), on_date: i.onDate, start_time: i.start && i.end ? i.start : null, end_time: i.start && i.end ? i.end : null });

  /** Starts a month's plan for a place as a draft. `copyFrom` brings another plan's activities along, each to the
   * same weekday of the same week of the new month (the 2nd Thursday stays the 2nd Thursday); an activity whose
   * week does not exist in the new month is left out. */
  async function createPlan(placeId: string, month: string, staffId: string | null, copyFrom?: string): Promise<MutationResult> {
    const { data: made, error: e } = await booking().from("plans").insert({ place_id: placeId, month: `${month}-01`, created_by: staffId }).select("id").single();
    if (e || !made) return done(e ?? { message: "The plan could not be started." });
    const copied = copyFrom ? data.items.filter((i) => i.planId === copyFrom) : [];
    const rows = copied.flatMap((i) => {
      const onDate = sameWeekdayIn(i.onDate, month);
      return onDate ? [{ ...itemRow({ ...i, onDate }), plan_id: made.id }] : [];
    });
    if (rows.length) return done((await booking().from("plan_items").insert(rows)).error);
    return done(null);
  }

  const addItem = async (planId: string, item: PlanItemInput) => done((await booking().from("plan_items").insert({ ...itemRow(item), plan_id: planId, sort: data.items.filter((i) => i.planId === planId).length + 1 })).error);
  const updateItem = async (id: string, item: PlanItemInput) => done((await booking().from("plan_items").update(itemRow(item)).eq("id", id)).error);
  const removeItem = async (id: string) => done((await booking().from("plan_items").delete().eq("id", id)).error);
  const saveNotes = async (id: string, notes: string) => done((await booking().from("plans").update({ notes: notes.trim(), updated_at: new Date().toISOString() }).eq("id", id)).error);

  /** Moves the plan on: sent to NCH, approved by NCH (who and when), returned by NCH, or reopened as a draft (which
   * takes its approval away, so its activities stop being offered on the booking page until it is approved again). */
  async function setStatus(id: string, status: PlanStatus, more: { on?: string; approvedBy?: string } = {}): Promise<MutationResult> {
    const row: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
    if (status === "submitted") row.submitted_on = more.on;
    if (status === "approved") Object.assign(row, { approved_on: more.on, approved_by: clean(more.approvedBy ?? "") || null });
    if (status === "draft") Object.assign(row, { approved_on: null, approved_by: null });
    return done((await booking().from("plans").update(row).eq("id", id)).error);
  }

  return { ...data, loading, error, createPlan, addItem, updateItem, removeItem, saveNotes, setStatus };
}
