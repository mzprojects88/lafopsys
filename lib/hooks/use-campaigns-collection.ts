"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";
import type { Campaign } from "@/lib/types/donor";

export type MutationResult = { ok: true } | { ok: false; error: string };

interface CampaignRow {
  id: string;
  name: string;
  target_amount: number;
  raised_amount: number;
  start_date: string;
  end_date: string | null;
}

function toCampaign(row: CampaignRow): Campaign {
  return {
    id: row.id,
    name: row.name,
    targetAmount: row.target_amount,
    raisedAmount: row.raised_amount,
    startDate: row.start_date,
    endDate: row.end_date ?? undefined,
  };
}

export const campaignsStore = createCollection<Campaign[]>({
  key: "ops.campaigns",
  empty: [],
  tables: [{ schema: "ops", table: "campaigns" }],
  fetch: async () => {
    const supabase = createClient();
    const { data, error } = await supabase.schema("ops").from("campaigns").select("*").order("start_date", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map(toCampaign);
  },
});

export function useCampaignsData() {
  const { data: campaigns, loading } = useCollection(campaignsStore);

  async function addCampaign(campaign: Omit<Campaign, "id" | "raisedAmount">): Promise<MutationResult> {
    const supabase = createClient();
    const { error } = await supabase.schema("ops").from("campaigns").insert({
      id: crypto.randomUUID(),
      name: campaign.name,
      target_amount: campaign.targetAmount,
      raised_amount: 0,
      start_date: campaign.startDate,
      end_date: campaign.endDate ?? null,
    });
    if (error) return { ok: false, error: error.message };
    await campaignsStore.refetch();
    return { ok: true };
  }

  return { campaigns, loading, addCampaign, refetch: campaignsStore.refetch };
}
