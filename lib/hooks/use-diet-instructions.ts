"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";

/** A doctor's food instructions for a child or their carer (0120). */
export interface DietInstruction {
  id: string;
  patientId: string;
  appliesTo: "patient" | "carer";
  carerName: string | null;
  instruction: string;
  givenBy: string | null;
  givenOn: string | null;
  until: string | null;
  active: boolean;
  createdAt: string;
}

export type DietInstructionDraft = Pick<DietInstruction, "patientId" | "appliesTo" | "carerName" | "instruction" | "givenBy" | "givenOn" | "until">;
export type MutationResult = { ok: true } | { ok: false; error: string };

const toRow = (d: DietInstructionDraft) => ({
  patient_id: d.patientId,
  applies_to: d.appliesTo,
  carer_name: d.appliesTo === "carer" ? d.carerName?.trim() || null : null,
  instruction: d.instruction.trim(),
  given_by: d.givenBy?.trim() || null,
  given_on: d.givenOn || null,
  until: d.until || null,
});

/** Readable by those who see clinical detail; written by Patients editors (the Social Worker). Empty for everyone else. */
export const dietInstructionsStore = createCollection<DietInstruction[]>({
  key: "ops.diet_instructions",
  empty: [],
  tables: [{ schema: "ops", table: "diet_instructions" }],
  fetch: async () => {
    const { data, error } = await createClient().schema("ops").from("diet_instructions").select("*").order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      id: String(r.id),
      patientId: String(r.patient_id),
      appliesTo: r.applies_to as "patient" | "carer",
      carerName: (r.carer_name as string | null) ?? null,
      instruction: String(r.instruction),
      givenBy: (r.given_by as string | null) ?? null,
      givenOn: (r.given_on as string | null) ?? null,
      until: (r.until as string | null) ?? null,
      active: r.active !== false,
      createdAt: String(r.created_at),
    }));
  },
});

export function useDietInstructions() {
  const { data: instructions, loading } = useCollection(dietInstructionsStore);
  const ops = () => createClient().schema("ops").from("diet_instructions");
  const done = async (error: { message: string } | null): Promise<MutationResult> => {
    if (error) return { ok: false, error: error.message };
    await dietInstructionsStore.refetch();
    return { ok: true };
  };
  return {
    instructions,
    loading,
    /** Active instructions for a child (and their carer). */
    forPatient: (patientId: string) => instructions.filter((i) => i.patientId === patientId && i.active),
    add: async (d: DietInstructionDraft) => done((await ops().insert(toRow(d))).error),
    update: async (id: string, d: DietInstructionDraft) => done((await ops().update(toRow(d)).eq("id", id)).error),
    /** Ended, not deleted: the record of what the doctor said stays. */
    end: async (id: string) => done((await ops().update({ active: false }).eq("id", id)).error),
  };
}
