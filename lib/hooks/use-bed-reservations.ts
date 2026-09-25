"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";
import type { BedHold } from "@/lib/utils/beds";

export type MutationResult = { ok: true } | { ok: false; error: string };

export interface BedReservation extends BedHold {
  patientId: string | null;
  houseSheetPersonId: string | null;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
}

interface Row {
  id: string;
  unit_id: string;
  patient_id: string | null;
  house_sheet_person_id: string | null;
  reserved_for: string;
  expected_on: string;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

/** Beds held right now for children who have not arrived (0065). */
export const bedReservationsStore = createCollection<BedReservation[]>({
  key: "ops.bed_reservations:active",
  empty: [],
  tables: [{ schema: "ops", table: "bed_reservations" }],
  fetch: async () => {
    const { data, error } = await createClient().schema("ops").from("bed_reservations").select("*").eq("status", "active").order("expected_on");
    if (error) throw new Error(error.message);
    return ((data ?? []) as Row[]).map((r) => ({
      id: r.id,
      unitId: r.unit_id,
      patientId: r.patient_id,
      houseSheetPersonId: r.house_sheet_person_id,
      reservedFor: r.reserved_for,
      expectedOn: r.expected_on,
      note: r.note,
      createdBy: r.created_by,
      createdAt: r.created_at,
    }));
  },
});

export function useBedReservations() {
  const { data: reservations, loading } = useCollection(bedReservationsStore);

  /** The hold for this child, by record or by their line on NCH's sheet. */
  const holdFor = (patientId?: string | null, sheetPersonId?: string | null) =>
    reservations.find((r) => (patientId && r.patientId === patientId) || (sheetPersonId && r.houseSheetPersonId === sheetPersonId));

  async function reserve(input: { unitId: string; patientId: string | null; sheetPersonId: string | null; reservedFor: string; expectedOn: string; note?: string }): Promise<MutationResult> {
    const { error } = await createClient()
      .schema("ops")
      .from("bed_reservations")
      .insert({
        unit_id: input.unitId,
        patient_id: input.patientId,
        house_sheet_person_id: input.sheetPersonId,
        reserved_for: input.reservedFor,
        expected_on: input.expectedOn,
        note: input.note?.trim() || null,
      });
    if (error) return { ok: false, error: /one_per/.test(error.message) ? "A bed is already held for this child; release it first." : error.message };
    await bedReservationsStore.refetch();
    return { ok: true };
  }

  /** Plans changed: the bed is free again. */
  async function release(id: string): Promise<MutationResult> {
    const { error } = await createClient().schema("ops").from("bed_reservations").update({ status: "released", closed_at: new Date().toISOString() }).eq("id", id).eq("status", "active");
    if (error) return { ok: false, error: error.message };
    await bedReservationsStore.refetch();
    return { ok: true };
  }

  /** Replacement (0066): the bed goes to another child, held for them to confirm at their check-in. */
  async function replace(id: string, to: { patientId: string | null; sheetPersonId: string | null; reservedFor: string }): Promise<MutationResult> {
    const { error } = await createClient().schema("ops").rpc("replace_bed_reservation", {
      p_id: id,
      p_patient_id: to.patientId,
      p_sheet_person_id: to.sheetPersonId,
      p_reserved_for: to.reservedFor,
    });
    if (error) return { ok: false, error: /one_per/.test(error.message) ? `A bed is already held for ${to.reservedFor}; release it first.` : error.message };
    await bedReservationsStore.refetch();
    return { ok: true };
  }

  return { reservations, loading, holdFor, reserve, release, replace };
}

/**
 * The child was checked in. On the held bed = confirmation ("used"); on
 * another bed, the held one is freed ("released"). Either way it names the stay.
 */
export async function closeReservation(hold: BedHold, stayId: string, unitId: string): Promise<string | null> {
  // 0067 closes it in the database with the stay; this is the same close, kept
  // for the moment in between (a no-op once the trigger has done it).
  const { error } = await createClient()
    .schema("ops")
    .from("bed_reservations")
    .update({ status: hold.unitId === unitId ? "used" : "released", used_stay_id: stayId, closed_at: new Date().toISOString() })
    .eq("id", hold.id)
    .eq("status", "active");
  await bedReservationsStore.refetch();
  return error?.message ?? null;
}
