"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";
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

export function useCampaignsData() {
  const [campaigns, setCampaigns] = React.useState<Campaign[]>([]);
  const [loading, setLoading] = React.useState(true);

  const refetch = React.useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.schema("ops").from("campaigns").select("*").order("start_date", { ascending: false });
    setCampaigns((data ?? []).map(toCampaign));
    setLoading(false);
  }, []);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from Supabase, an external system
    refetch();
  }, [refetch]);

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
    await refetch();
    return { ok: true };
  }

  return { campaigns, loading, addCampaign, refetch };
}
