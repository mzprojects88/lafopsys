"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";
import type { AcknowledgmentReceipt, ArStatus } from "@/lib/types/donor";
import type { Currency } from "@/lib/types/common";

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
  issued_by: string | null;
  booklet_number: string | null;
  amount: number | string | null;
  currency: Currency | null;
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
    issuedBy: row.issued_by ?? undefined,
    bookletNumber: row.booklet_number ?? undefined,
    amount: row.amount == null ? undefined : Number(row.amount),
    currency: row.currency ?? undefined,
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

/** Cash ARs are numbered by the database (0085): the browser only asks for one and reads the result. */
export function useAcknowledgmentReceiptsData() {
  const { data: receipts, loading } = useCollection(acknowledgmentReceiptsStore);

  async function issueCashAr(donationId: string): Promise<MutationResult & { number?: string }> {
    const { data, error } = await createClient().schema("ops").rpc("issue_cash_ar", { p_donation: donationId });
    if (error) return { ok: false, error: error.message };
    await acknowledgmentReceiptsStore.refetch();
    return { ok: true, number: data as string };
  }

  async function advanceStatus(id: string): Promise<MutationResult & { status?: ArStatus }> {
    const { data, error } = await createClient().schema("ops").rpc("advance_ar", { p_id: id });
    if (error) return { ok: false, error: error.message };
    await acknowledgmentReceiptsStore.refetch();
    return { ok: true, status: data as ArStatus };
  }

  /** The paper receipt number from accounting's booklet (0122): set or corrected by a donors editor. */
  async function setPaperNumber(id: string, number: string): Promise<MutationResult> {
    const { error } = await createClient().schema("ops").rpc("set_receipt_paper_number", { p_id: id, p_number: number });
    if (error) return { ok: false, error: error.message };
    await acknowledgmentReceiptsStore.refetch();
    return { ok: true };
  }

  return { receipts, loading, issueCashAr, advanceStatus, setPaperNumber, refetch: acknowledgmentReceiptsStore.refetch };
}
