"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";
import { fetchAll } from "@/lib/supabase/fetch-all";
import type {
  ActivitySource,
  BookingActivityType,
  BookingClosure,
  BookingEvent,
  BookingItem,
  BookingPlace,
  BookingRequest,
  BookingSettings,
  BookingSlot,
  BookingStatus,
  BookingVolunteer,
  RequestorKind,
  SlotOfDay,
  SlotState,
} from "@/lib/types/booking";

export type MutationResult = { ok: true } | { ok: false; error: string };

const booking = () => createClient().schema("booking");
const text = (v: unknown) => (typeof v === "string" ? v : "");
const hhmm = (v: unknown) => text(v).slice(0, 5);
const fail = (error: { message: string } | null): MutationResult => (error ? { ok: false, error: error.message } : { ok: true });

const DEFAULT_SETTINGS: BookingSettings = { minDaysAhead: 14, maxDaysAhead: 60, maxVolunteers: 10, maxOpenRequests: 2, namesDueDays: 3, replyDays: 3, guidelines: "", prohibited: "", privacyNotice: "", siteUrl: "" };

export interface BookingSetup {
  settings: BookingSettings;
  places: BookingPlace[];
  slots: BookingSlot[];
  closures: BookingClosure[];
  activityTypes: BookingActivityType[];
}

/** What Settings keeps (0172): the limits and texts, the places, their weekly slots, closed dates and the activity list. */
export const bookingSetupStore = createCollection<BookingSetup>({
  key: "booking.setup",
  empty: { settings: DEFAULT_SETTINGS, places: [], slots: [], closures: [], activityTypes: [] },
  tables: [
    { schema: "booking", table: "settings" },
    { schema: "booking", table: "places" },
    { schema: "booking", table: "slots" },
    { schema: "booking", table: "closures" },
    { schema: "booking", table: "activity_types" },
  ],
  fetch: async () => {
    const [s, p, sl, c, a] = await Promise.all([
      booking().from("settings").select("min_days_ahead, max_days_ahead, max_volunteers, max_open_requests, names_due_days, reply_days, guidelines, prohibited, privacy_notice, site_url").maybeSingle(),
      booking().from("places").select("id, name, site, where_to_go, instructions, coordinator_name, coordinator_phone, open, sort").order("sort").order("name"),
      booking().from("slots").select("id, place_id, weekday, start_time, end_time, active").order("weekday").order("start_time"),
      booking().from("closures").select("id, place_id, date_from, date_to, reason").order("date_from", { ascending: false }),
      booking().from("activity_types").select("id, name, active, sort").order("sort").order("name"),
    ]);
    const error = s.error ?? p.error ?? sl.error ?? c.error ?? a.error;
    if (error) throw new Error(error.message);
    return {
      settings: s.data
        ? {
            minDaysAhead: Number(s.data.min_days_ahead),
            maxDaysAhead: Number(s.data.max_days_ahead),
            maxVolunteers: Number(s.data.max_volunteers),
            maxOpenRequests: Number(s.data.max_open_requests),
            namesDueDays: Number(s.data.names_due_days),
            replyDays: Number(s.data.reply_days),
            guidelines: text(s.data.guidelines),
            prohibited: text(s.data.prohibited),
            privacyNotice: text(s.data.privacy_notice),
            siteUrl: text(s.data.site_url),
          }
        : DEFAULT_SETTINGS,
      places: (p.data ?? []).map((r) => ({
        id: r.id as string,
        name: text(r.name),
        site: r.site === "LAF" ? "LAF" : "NCH",
        whereToGo: text(r.where_to_go),
        instructions: text(r.instructions),
        coordinatorName: text(r.coordinator_name),
        coordinatorPhone: text(r.coordinator_phone),
        open: r.open === true,
        sort: Number(r.sort ?? 0),
      })),
      slots: (sl.data ?? []).map((r) => ({ id: r.id as string, placeId: r.place_id as string, weekday: Number(r.weekday), start: hhmm(r.start_time), end: hhmm(r.end_time), active: r.active === true })),
      closures: (c.data ?? []).map((r) => ({ id: r.id as string, placeId: (r.place_id as string | null) ?? null, dateFrom: text(r.date_from), dateTo: text(r.date_to), reason: text(r.reason) })),
      activityTypes: (a.data ?? []).map((r) => ({ id: r.id as string, name: text(r.name), active: r.active === true, sort: Number(r.sort ?? 0) })),
    };
  },
});

export interface BookingRequests {
  requests: BookingRequest[];
  items: BookingItem[];
  volunteers: BookingVolunteer[];
  events: BookingEvent[];
}

const REQUEST_COLUMNS =
  "id, ref, seq_no, place_id, date, start_time, end_time, status, requestor_name, requestor_kind, contact_person, email, mobile, volunteers_count, has_minors, off_plan, nch_contact, nch_coordinated_at, nch_notes, decline_reason, staff_note, instructions, attended_children, attended_volunteers, attended_hours, created_at, decided_at";

/** Every request with its program flow, its volunteers' names and its trail.
 * ponytail: all of them are loaded; page them by month once there are a few thousand. */
export const bookingRequestsStore = createCollection<BookingRequests>({
  key: "booking.requests",
  empty: { requests: [], items: [], volunteers: [], events: [] },
  tables: [
    { schema: "booking", table: "requests" },
    { schema: "booking", table: "request_items" },
    { schema: "booking", table: "volunteers" },
    { schema: "booking", table: "events" },
  ],
  fetch: async () => {
    type Row = Record<string, unknown>;
    const [requests, items, volunteers, events] = await Promise.all([
      fetchAll<Row>((from, to) => booking().from("requests").select(REQUEST_COLUMNS).order("date", { ascending: false }).order("id").range(from, to)),
      fetchAll<Row>((from, to) => booking().from("request_items").select("id, request_id, position, activity, source, purpose, who, ages, gender, participants_note, start_time, end_time, materials").order("request_id").order("position").range(from, to)),
      fetchAll<Row>((from, to) => booking().from("volunteers").select("id, request_id, position, name").order("request_id").order("position").range(from, to)),
      fetchAll<Row>((from, to) => booking().from("events").select("id, request_id, at, actor, by_requestor, action, detail").order("at").order("id").range(from, to)),
    ]);
    const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
    return {
      requests: requests.map((r) => ({
        id: r.id as string,
        ref: text(r.ref),
        seqNo: text(r.seq_no),
        placeId: r.place_id as string,
        date: text(r.date),
        start: hhmm(r.start_time),
        end: hhmm(r.end_time),
        status: r.status as BookingStatus,
        requestorName: text(r.requestor_name),
        requestorKind: r.requestor_kind as RequestorKind,
        contactPerson: text(r.contact_person),
        email: text(r.email),
        mobile: text(r.mobile),
        volunteersCount: Number(r.volunteers_count ?? 0),
        hasMinors: r.has_minors === true,
        offPlan: r.off_plan === true,
        nchContact: text(r.nch_contact),
        nchCoordinatedAt: (r.nch_coordinated_at as string | null) ?? null,
        nchNotes: text(r.nch_notes),
        declineReason: text(r.decline_reason),
        staffNote: text(r.staff_note),
        instructions: text(r.instructions),
        attendedChildren: n(r.attended_children),
        attendedVolunteers: n(r.attended_volunteers),
        attendedHours: n(r.attended_hours),
        createdAt: text(r.created_at),
        decidedAt: (r.decided_at as string | null) ?? null,
      })),
      items: items.map((r) => ({
        id: r.id as string,
        requestId: r.request_id as string,
        position: Number(r.position),
        activity: text(r.activity),
        source: r.source as ActivitySource,
        purpose: text(r.purpose),
        who: r.who === "carers" ? "carers" : r.who === "both" ? "both" : "patients",
        ages: text(r.ages),
        gender: r.gender === "girls" ? "girls" : r.gender === "boys" ? "boys" : "all",
        note: text(r.participants_note),
        start: hhmm(r.start_time),
        end: hhmm(r.end_time),
        materials: text(r.materials),
      })),
      volunteers: volunteers.map((r) => ({ id: r.id as string, requestId: r.request_id as string, position: Number(r.position), name: text(r.name) })),
      events: events.map((r) => ({ id: r.id as string, requestId: r.request_id as string, at: text(r.at), actor: (r.actor as string | null) ?? null, byRequestor: r.by_requestor === true, action: text(r.action), detail: text(r.detail) })),
    };
  },
});

/** Every slot of a place between two days, with its state (booking.staff_slot_states: a read, so asked for as one). */
export async function fetchSlotStates(placeId: string, from: string, to: string): Promise<SlotOfDay[]> {
  const { data, error } = await booking().rpc("staff_slot_states", { p_place: placeId, p_from: from, p_to: to }, { get: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as { day: string; start_time: string; end_time: string; state: SlotState }[]).map((r) => ({ day: r.day, start: hhmm(r.start_time), end: hhmm(r.end_time), state: r.state }));
}

export type BookingStep = "approve" | "decline" | "cancel" | "move" | "complete" | "no_show";

export function useBookingRequests() {
  const { data, loading, error } = useCollection(bookingRequestsStore);

  /** A step on a request. It goes through the server, which runs booking.decide as this person (the database
   * checks who may and whether the step fits) and, once it succeeded, queues the requestor's email. */
  async function decide(id: string, step: BookingStep, payload: Record<string, unknown> = {}): Promise<MutationResult> {
    const res = await fetch("/api/bookings/decide", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, step, payload }) }).catch(() => null);
    const out = (await res?.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!res?.ok || !out?.ok) return { ok: false, error: out?.error ?? "The step did not go through. Check your connection and try again." };
    await bookingRequestsStore.refetch();
    return { ok: true };
  }

  /** What editors keep by hand on a request: the note for staff, the instructions for this booking, and the
   * coordination with NCH. */
  async function saveNotes(id: string, patch: { staffNote?: string; instructions?: string; nchContact?: string; nchCoordinatedAt?: string | null; nchNotes?: string }): Promise<MutationResult> {
    const row: Record<string, unknown> = {};
    if (patch.staffNote !== undefined) row.staff_note = patch.staffNote.trim();
    if (patch.instructions !== undefined) row.instructions = patch.instructions.trim();
    if (patch.nchContact !== undefined) row.nch_contact = patch.nchContact.trim() || null;
    if (patch.nchCoordinatedAt !== undefined) row.nch_coordinated_at = patch.nchCoordinatedAt || null;
    if (patch.nchNotes !== undefined) row.nch_notes = patch.nchNotes.trim() || null;
    const { data: saved, error: e } = await booking().from("requests").update(row).eq("id", id).select("id");
    if (e) return { ok: false, error: e.message };
    if (!saved?.length) return { ok: false, error: "Only the people who process bookings can change this." };
    await bookingRequestsStore.refetch();
    return { ok: true };
  }

  /** The volunteers' names, replaced as a whole (staff may fix what the group typed). */
  async function saveVolunteers(id: string, names: string[]): Promise<MutationResult> {
    const clean = names.map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean);
    const removed = await booking().from("volunteers").delete().eq("request_id", id);
    if (removed.error) return { ok: false, error: removed.error.message };
    if (clean.length) {
      const added = await booking().from("volunteers").insert(clean.map((name, i) => ({ request_id: id, position: i + 1, name })));
      if (added.error) {
        await bookingRequestsStore.refetch();
        return { ok: false, error: added.error.message };
      }
    }
    await bookingRequestsStore.refetch();
    return { ok: true };
  }

  return { ...data, loading, error, decide, saveNotes, saveVolunteers };
}

export function useBookingSetup() {
  const { data, loading, error } = useCollection(bookingSetupStore);
  const done = async (e: { message: string } | null): Promise<MutationResult> => {
    if (!e) await bookingSetupStore.refetch();
    return fail(e);
  };

  async function saveSettings(patch: Partial<BookingSettings>): Promise<MutationResult> {
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.minDaysAhead !== undefined) row.min_days_ahead = patch.minDaysAhead;
    if (patch.maxDaysAhead !== undefined) row.max_days_ahead = patch.maxDaysAhead;
    if (patch.maxVolunteers !== undefined) row.max_volunteers = patch.maxVolunteers;
    if (patch.maxOpenRequests !== undefined) row.max_open_requests = patch.maxOpenRequests;
    if (patch.namesDueDays !== undefined) row.names_due_days = patch.namesDueDays;
    if (patch.replyDays !== undefined) row.reply_days = patch.replyDays;
    if (patch.guidelines !== undefined) row.guidelines = patch.guidelines;
    if (patch.prohibited !== undefined) row.prohibited = patch.prohibited;
    if (patch.privacyNotice !== undefined) row.privacy_notice = patch.privacyNotice;
    if (patch.siteUrl !== undefined) row.site_url = patch.siteUrl.trim().replace(/\/+$/, "");
    const { data: saved, error: e } = await booking().from("settings").update(row).eq("id", true).select("id");
    if (!e && !saved?.length) return { ok: false, error: "Only the people who process bookings can change these." };
    return done(e);
  }

  type PlaceInput = Omit<BookingPlace, "id" | "sort">;
  const placeRow = (p: Partial<PlaceInput>) => {
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (p.name !== undefined) row.name = p.name.trim();
    if (p.site !== undefined) row.site = p.site;
    if (p.whereToGo !== undefined) row.where_to_go = p.whereToGo.trim();
    if (p.instructions !== undefined) row.instructions = p.instructions.trim();
    if (p.coordinatorName !== undefined) row.coordinator_name = p.coordinatorName.trim();
    if (p.coordinatorPhone !== undefined) row.coordinator_phone = p.coordinatorPhone.trim();
    if (p.open !== undefined) row.open = p.open;
    return row;
  };
  const addPlace = async (p: PlaceInput) => done((await booking().from("places").insert({ ...placeRow(p), sort: data.places.length + 1 })).error);
  const updatePlace = async (id: string, p: Partial<PlaceInput>) => done((await booking().from("places").update(placeRow(p)).eq("id", id)).error);

  const addSlot = async (placeId: string, weekday: number, start: string, end: string) => done((await booking().from("slots").insert({ place_id: placeId, weekday, start_time: start, end_time: end })).error);
  const updateSlot = async (id: string, patch: { start?: string; end?: string; active?: boolean }) =>
    done((await booking().from("slots").update({ ...(patch.start ? { start_time: patch.start } : {}), ...(patch.end ? { end_time: patch.end } : {}), ...(patch.active !== undefined ? { active: patch.active } : {}) }).eq("id", id)).error);
  const removeSlot = async (id: string) => done((await booking().from("slots").delete().eq("id", id)).error);

  const addClosure = async (c: Omit<BookingClosure, "id">) => done((await booking().from("closures").insert({ place_id: c.placeId, date_from: c.dateFrom, date_to: c.dateTo, reason: c.reason.trim() })).error);
  const removeClosure = async (id: string) => done((await booking().from("closures").delete().eq("id", id)).error);

  const addActivityType = async (name: string) => done((await booking().from("activity_types").insert({ name: name.replace(/\s+/g, " ").trim(), sort: data.activityTypes.length + 1 })).error);
  const updateActivityType = async (id: string, patch: { name?: string; active?: boolean }) =>
    done((await booking().from("activity_types").update({ ...(patch.name ? { name: patch.name.replace(/\s+/g, " ").trim() } : {}), ...(patch.active !== undefined ? { active: patch.active } : {}) }).eq("id", id)).error);

  return { ...data, loading, error, saveSettings, addPlace, updatePlace, addSlot, updateSlot, removeSlot, addClosure, removeClosure, addActivityType, updateActivityType };
}
