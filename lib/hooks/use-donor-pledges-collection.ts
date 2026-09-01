"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";
import type { DonorPledge, PledgeStatus } from "@/lib/types/donor";

export type MutationResult = { ok: true } | { ok: false; error: string };

interface DonorPledgeRow {
  id: string;
  donor_id: string;
  kind: DonorPledge["kind"];
  frequency: DonorPledge["frequency"];
  amount: number | null;
  currency: DonorPledge["currency"] | null;
  item_description: string | null;
  status: PledgeStatus;
  started_at: string;
  notes: string | null;
}

function toDonorPledge(row: DonorPledgeRow): DonorPledge {
  return {
    id: row.id,
    donorId: row.donor_id,
    kind: row.kind,
    frequency: row.frequency,
    amount: row.amount ?? undefined,
    currency: row.currency ?? undefined,
    itemDescription: row.item_description ?? undefined,
    status: row.status,
    startedAt: row.started_at,
    notes: row.notes ?? undefined,
  };
}

/** ops.donor_pledges -- staff-recorded recurring commitments. Read/write
 * staff-side; donors get a read-only view of their own row (RLS-scoped, no
 * client-side filtering needed for that case). */
export function useDonorPledgesData() {
  const [pledges, setPledges] = React.useState<DonorPledge[]>([]);
  const [loading, setLoading] = React.useState(true);

  const refetch = React.useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.schema("ops").from("donor_pledges").select("*").order("started_at", { ascending: false });
    setPledges((data ?? []).map(toDonorPledge));
    setLoading(false);
  }, []);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from Supabase, an external system
    refetch();
  }, [refetch]);

  async function addPledge(pledge: Omit<DonorPledge, "id" | "status">): Promise<MutationResult> {
    const supabase = createClient();
    const { error } = await supabase.schema("ops").from("donor_pledges").insert({
      id: crypto.randomUUID(),
      donor_id: pledge.donorId,
      kind: pledge.kind,
      frequency: pledge.frequency,
      amount: pledge.amount ?? null,
      currency: pledge.currency ?? null,
      item_description: pledge.itemDescription ?? null,
      status: "active",
      started_at: pledge.startedAt,
      notes: pledge.notes ?? null,
    });
    if (error) return { ok: false, error: error.message };
    await refetch();
    return { ok: true };
  }

  async function updatePledgeStatus(id: string, status: PledgeStatus): Promise<MutationResult> {
    const supabase = createClient();
    const { error } = await supabase.schema("ops").from("donor_pledges").update({ status }).eq("id", id);
    if (error) return { ok: false, error: error.message };
    await refetch();
    return { ok: true };
  }

  return { pledges, loading, addPledge, updatePledgeStatus, refetch };
}
