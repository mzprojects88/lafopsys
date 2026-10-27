"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";
import type { Volunteer, VolunteerHours } from "@/lib/types/staff";

export type MutationResult = { ok: true } | { ok: false; error: string };

interface VolunteerRow {
  id: string;
  first_name: string;
  last_name: string;
  focus_area: Volunteer["focusArea"];
  total_hours: number | string;
  last_session_date: string | null;
  certificates_issued: number;
  phone: string | null;
  email: string | null;
  active: boolean | null;
}

interface HoursRow {
  id: string;
  volunteer_id: string;
  date: string;
  hours: number | string;
  activity: VolunteerHours["activity"];
  note: string | null;
}

/** ops.volunteers (0013, 0116). Total hours and last session are kept by the database from the hours log. */
export const volunteersStore = createCollection<Volunteer[]>({
  key: "ops.volunteers",
  empty: [],
  tables: [{ schema: "ops", table: "volunteers" }],
  fetch: async () => {
    const { data, error } = await createClient().schema("ops").from("volunteers").select("*").order("first_name");
    if (error) throw new Error(error.message);
    return ((data ?? []) as VolunteerRow[]).map((r) => ({
      id: r.id,
      firstName: r.first_name,
      lastName: r.last_name,
      focusArea: r.focus_area,
      totalHours: Number(r.total_hours ?? 0),
      lastSessionDate: r.last_session_date ?? "",
      certificatesIssued: r.certificates_issued ?? 0,
      phone: r.phone ?? "",
      email: r.email ?? "",
      active: r.active ?? true,
    }));
  },
});

/** ops.volunteer_hours (0116): every session served, newest first. */
export const volunteerHoursStore = createCollection<VolunteerHours[]>({
  key: "ops.volunteer_hours",
  empty: [],
  tables: [{ schema: "ops", table: "volunteer_hours" }],
  fetch: async () => {
    const { data, error } = await createClient().schema("ops").from("volunteer_hours").select("id, volunteer_id, date, hours, activity, note").order("date", { ascending: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as HoursRow[]).map((r) => ({ id: r.id, volunteerId: r.volunteer_id, date: r.date, hours: Number(r.hours), activity: r.activity, note: r.note ?? "" }));
  },
});

export type VolunteerDraft = Pick<Volunteer, "firstName" | "lastName" | "focusArea" | "phone" | "email" | "active">;
const toRow = (v: VolunteerDraft) => ({
  first_name: v.firstName.trim(),
  last_name: v.lastName.trim(),
  focus_area: v.focusArea,
  phone: v.phone.trim() || null,
  email: v.email.trim() || null,
  active: v.active,
});

export function useVolunteersData() {
  const { data: volunteers, loading } = useCollection(volunteersStore);
  const { data: hours } = useCollection(volunteerHoursStore);
  const ops = () => createClient().schema("ops");
  const done = async (error: { message: string } | null, stores: { refetch: () => Promise<unknown> }[] = [volunteersStore]): Promise<MutationResult> => {
    if (error) return { ok: false, error: error.message };
    await Promise.all(stores.map((s) => s.refetch()));
    return { ok: true };
  };

  return {
    volunteers,
    hours,
    loading,
    addVolunteer: async (v: VolunteerDraft) => done((await ops().from("volunteers").insert({ id: crypto.randomUUID(), ...toRow(v) })).error),
    updateVolunteer: async (id: string, v: VolunteerDraft) => done((await ops().from("volunteers").update(toRow(v)).eq("id", id)).error),
    logHours: async (h: Omit<VolunteerHours, "id">) =>
      done((await ops().from("volunteer_hours").insert({ volunteer_id: h.volunteerId, date: h.date, hours: h.hours, activity: h.activity, note: h.note.trim() || null })).error, [volunteerHoursStore, volunteersStore]),
    removeHours: async (id: string) => done((await ops().from("volunteer_hours").delete().eq("id", id)).error, [volunteerHoursStore, volunteersStore]),
    refetch: () => Promise.all([volunteersStore.refetch(), volunteerHoursStore.refetch()]),
  };
}
