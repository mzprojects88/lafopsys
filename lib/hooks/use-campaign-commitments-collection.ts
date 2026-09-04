"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";
import type { CampaignCommitment } from "@/lib/types/donor";

export type MutationResult = { ok: true } | { ok: false; error: string };

interface CampaignCommitmentRow {
  id: string;
  donor_id: string;
  campaign_id: string;
  kind: CampaignCommitment["kind"];
  pledged_amount: number | null;
  currency: CampaignCommitment["currency"] | null;
  item_description: string | null;
  status: CampaignCommitment["status"];
  fulfilled_donation_id: string | null;
  created_at: string;
}

function toCampaignCommitment(row: CampaignCommitmentRow): CampaignCommitment {
  return {
    id: row.id,
    donorId: row.donor_id,
    campaignId: row.campaign_id,
    kind: row.kind,
    pledgedAmount: row.pledged_amount ?? undefined,
    currency: row.currency ?? undefined,
    itemDescription: row.item_description ?? undefined,
    status: row.status,
    fulfilledDonationId: row.fulfilled_donation_id ?? undefined,
    createdAt: row.created_at,
  };
}

/** ops.campaign_commitments -- a donor "joining" a campaign creates a
 * pledge/lead record here, not a real donation. Staff see every commitment
 * (full-access RLS); a donor session only ever gets their own rows back
 * (RLS-scoped), so no client-side filtering is needed for that case either. */
export const campaignCommitmentsStore = createCollection<CampaignCommitment[]>({
  key: "ops.campaign_commitments",
  empty: [],
  tables: [{ schema: "ops", table: "campaign_commitments" }],
  fetch: async () => {
    const supabase = createClient();
    const { data, error } = await supabase
      .schema("ops")
      .from("campaign_commitments")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map(toCampaignCommitment);
  },
});

export function useCampaignCommitmentsData() {
  const { data: commitments, loading } = useCollection(campaignCommitmentsStore);

  async function addCommitment(commitment: Omit<CampaignCommitment, "id" | "status" | "fulfilledDonationId" | "createdAt">): Promise<MutationResult> {
    const supabase = createClient();
    const { error } = await supabase.schema("ops").from("campaign_commitments").insert({
      id: crypto.randomUUID(),
      donor_id: commitment.donorId,
      campaign_id: commitment.campaignId,
      kind: commitment.kind,
      pledged_amount: commitment.pledgedAmount ?? null,
      currency: commitment.currency ?? null,
      item_description: commitment.itemDescription ?? null,
      status: "pledged",
    });
    if (error) return { ok: false, error: error.message };
    await campaignCommitmentsStore.refetch();
    return { ok: true };
  }

  /** Donor withdrawing their own still-open pledge -- RLS only allows this
   * exact transition (pledged -> cancelled), enforced again here client-side
   * so the button doesn't even try on an already-fulfilled commitment. */
  async function cancelCommitment(id: string): Promise<MutationResult> {
    const supabase = createClient();
    const { error } = await supabase
      .schema("ops")
      .from("campaign_commitments")
      .update({ status: "cancelled" })
      .eq("id", id)
      .eq("status", "pledged");
    if (error) return { ok: false, error: error.message };
    await campaignCommitmentsStore.refetch();
    return { ok: true };
  }

  /** Staff marking a commitment fulfilled once the real donation is recorded. */
  async function markFulfilled(id: string, donationId: string): Promise<MutationResult> {
    const supabase = createClient();
    const { error } = await supabase
      .schema("ops")
      .from("campaign_commitments")
      .update({ status: "fulfilled", fulfilled_donation_id: donationId })
      .eq("id", id);
    if (error) return { ok: false, error: error.message };
    await campaignCommitmentsStore.refetch();
    return { ok: true };
  }

  return { commitments, loading, addCommitment, cancelCommitment, markFulfilled, refetch: campaignCommitmentsStore.refetch };
}
