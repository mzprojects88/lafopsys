"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";
import type { Campaign } from "@/lib/types/donor";

export type MutationResult = { ok: true } | { ok: false; error: string };

interface CampaignRow {
  id: string;
  name: string;
  description: string | null;
  status: "active" | "closed";
  target_amount: number | string;
  raised_amount: number | string;
  start_date: string;
  end_date: string | null;
}

function toCampaign(row: CampaignRow): Campaign {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    status: row.status,
    targetAmount: Number(row.target_amount),
    raisedAmount: Number(row.raised_amount),
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

export type CampaignInput = { name: string; description?: string; targetAmount: number; startDate: string; endDate?: string; status?: Campaign["status"] };

/** raised_amount follows the finalized PHP gifts linked to the campaign (0086); the browser never sends it. */
export function useCampaignsData() {
  const { data: campaigns, loading } = useCollection(campaignsStore);

  const row = (c: CampaignInput) => ({
    name: c.name.trim(),
    description: c.description?.trim() || null,
    target_amount: c.targetAmount,
    start_date: c.startDate,
    end_date: c.endDate ?? null,
    ...(c.status ? { status: c.status } : {}),
  });

  async function addCampaign(campaign: CampaignInput): Promise<MutationResult> {
    const { error } = await createClient().schema("ops").from("campaigns").insert({ id: crypto.randomUUID(), ...row(campaign) });
    if (error) return { ok: false, error: error.message };
    await campaignsStore.refetch();
    return { ok: true };
  }

  async function updateCampaign(id: string, campaign: CampaignInput): Promise<MutationResult> {
    const { data, error } = await createClient().schema("ops").from("campaigns").update(row(campaign)).eq("id", id).select("id");
    if (error) return { ok: false, error: error.message };
    if (!data?.length) return { ok: false, error: "You don't have permission to change campaigns." };
    await campaignsStore.refetch();
    return { ok: true };
  }

  /** Only a campaign without gifts can go; one with gifts is closed instead (the database refuses the delete). */
  async function deleteCampaign(id: string): Promise<MutationResult> {
    const { data, error } = await createClient().schema("ops").from("campaigns").delete().eq("id", id).select("id");
    if (error) return { ok: false, error: /foreign key|violates/i.test(error.message) ? "This campaign has gifts; close it instead." : error.message };
    if (!data?.length) return { ok: false, error: "You don't have permission to delete campaigns." };
    await campaignsStore.refetch();
    return { ok: true };
  }

  return { campaigns, loading, addCampaign, updateCampaign, deleteCampaign, refetch: campaignsStore.refetch };
}
