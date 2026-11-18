"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";

export type MutationResult = { ok: true } | { ok: false; error: string };

/** A Patient ID card (0164). The QR's code itself stays on the server: the screens never need it. */
export interface PatientCard {
  id: string;
  patientId: string;
  version: number;
  status: "active" | "replaced" | "switched_off";
  issuedAt: string;
  endedAt: string | null;
  endedReason: string | null;
}

interface Row {
  id: string;
  patient_id: string;
  version: number;
  status: PatientCard["status"];
  issued_at: string;
  ended_at: string | null;
  ended_reason: string | null;
}

export const patientCardsStore = createCollection<PatientCard[]>({
  key: "ops.patient_cards",
  empty: [],
  tables: [{ schema: "ops", table: "patient_cards" }],
  fetch: async () => {
    const { data, error } = await createClient()
      .schema("ops")
      .from("patient_cards")
      .select("id, patient_id, version, status, issued_at, ended_at, ended_reason")
      .order("version", { ascending: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as Row[]).map((r) => ({
      id: r.id,
      patientId: r.patient_id,
      version: r.version,
      status: r.status,
      issuedAt: r.issued_at,
      endedAt: r.ended_at,
      endedReason: r.ended_reason,
    }));
  },
});

export function usePatientCards() {
  const { data: cards, loading } = useCollection(patientCardsStore);
  const activeCard = (patientId: string) => cards.find((c) => c.patientId === patientId && c.status === "active");

  /** Issue a card, or a new one for a lost or damaged card (the old one stops working). */
  async function issue(patientId: string, reason?: string): Promise<MutationResult> {
    const { error } = await createClient().schema("ops").rpc("issue_patient_card", { p_patient_id: patientId, p_reason: reason ?? null });
    if (error) return { ok: false, error: error.message };
    await patientCardsStore.refetch();
    return { ok: true };
  }

  async function switchOff(cardId: string, reason: string): Promise<MutationResult> {
    const { error } = await createClient().schema("ops").rpc("switch_off_patient_card", { p_card_id: cardId, p_reason: reason });
    if (error) return { ok: false, error: error.message };
    await patientCardsStore.refetch();
    return { ok: true };
  }

  return { cards, loading, activeCard, issue, switchOff };
}

/** The printable sheet for these children's active cards (three a page, cut and fold). */
export const idCardsPdfUrl = (patientIds: string[]) => `/api/patients/id-cards?patients=${patientIds.join(",")}`;
