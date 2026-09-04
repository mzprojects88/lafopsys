"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";
import type { AcknowledgmentReceipt, ArStatus } from "@/lib/types/donor";

export type MutationResult = { ok: true } | { ok: false; error: string };

interface AcknowledgmentReceiptRow {
  id: string;
  donation_id: string;
  sequence_number: string;
  entity: AcknowledgmentReceipt["entity"];
  status: ArStatus;
  issued_at: string | null;
  sent_at: string | null;
  acknowledged_at: string | null;
}

function toAcknowledgmentReceipt(row: AcknowledgmentReceiptRow): AcknowledgmentReceipt {
  return {
    id: row.id,
    donationId: row.donation_id,
    sequenceNumber: row.sequence_number,
    entity: row.entity,
    status: row.status,
    issuedAt: row.issued_at ?? undefined,
    sentAt: row.sent_at ?? undefined,
    acknowledgedAt: row.acknowledged_at ?? undefined,
  };
}

export const acknowledgmentReceiptsStore = createCollection<AcknowledgmentReceipt[]>({
  key: "ops.acknowledgment_receipts",
  empty: [],
  tables: [{ schema: "ops", table: "acknowledgment_receipts" }],
  fetch: async () => {
    const supabase = createClient();
    const { data, error } = await supabase.schema("ops").from("acknowledgment_receipts").select("*").order("issued_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map(toAcknowledgmentReceipt);
  },
});

export function useAcknowledgmentReceiptsData() {
  const { data: receipts, loading } = useCollection(acknowledgmentReceiptsStore);

  async function generateReceipt(donationId: string, entity: AcknowledgmentReceipt["entity"]): Promise<MutationResult> {
    const supabase = createClient();
    const year = new Date().getFullYear();
    const sequenceNumber = `AR-${year}-${Date.now().toString().slice(-6)}`;
    const { error } = await supabase.schema("ops").from("acknowledgment_receipts").insert({
      id: crypto.randomUUID(),
      donation_id: donationId,
      sequence_number: sequenceNumber,
      entity,
      status: "draft",
      issued_at: new Date().toISOString(),
    });
    if (error) return { ok: false, error: error.message };
    await acknowledgmentReceiptsStore.refetch();
    return { ok: true };
  }

  async function advanceStatus(id: string, nextStatus: ArStatus): Promise<MutationResult> {
    const supabase = createClient();
    const row: Record<string, unknown> = { status: nextStatus };
    if (nextStatus === "sent") row.sent_at = new Date().toISOString();
    if (nextStatus === "acknowledged") row.acknowledged_at = new Date().toISOString();
    const { error } = await supabase.schema("ops").from("acknowledgment_receipts").update(row).eq("id", id);
    if (error) return { ok: false, error: error.message };
    await acknowledgmentReceiptsStore.refetch();
    return { ok: true };
  }

  return { receipts, loading, generateReceipt, advanceStatus, refetch: acknowledgmentReceiptsStore.refetch };
}
