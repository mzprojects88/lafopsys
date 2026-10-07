"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, invalidateTables, useCollection } from "@/lib/data/collection-store";
import type { Donor, Donation } from "@/lib/types/donor";
import type { DonorInput } from "@/lib/utils/donor-details";

export type MutationResult = { ok: true } | { ok: false; error: string };

interface DonorRow {
  id: string;
  name: string;
  type: Donor["type"];
  email: string | null;
  phone: string | null;
  tax_jurisdiction: Donor["taxJurisdiction"];
  tin: string | null;
  first_gift_date: string | null;
  last_gift_date: string | null;
  lifetime_value: number;
  gift_count: number;
}

interface DonationRow {
  id: string;
  donor_id: string;
  date: string;
  receiving_entity: Donation["receivingEntity"];
  kind: Donation["kind"];
  item_description: string | null;
  item_type: string | null;
  quantity: number | null;
  uom_id: string | null;
  unit_value: number | null;
  total_value: number;
  currency: Donation["currency"];
  campaign_id: string | null;
  created_inventory_lot_id: string | null;
  status: NonNullable<Donation["status"]>;
}

function toDonor(row: DonorRow): Donor {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    email: row.email ?? undefined,
    phone: row.phone ?? undefined,
    taxJurisdiction: row.tax_jurisdiction,
    tin: row.tin ?? undefined,
    firstGiftDate: row.first_gift_date ?? "",
    lastGiftDate: row.last_gift_date ?? "",
    lifetimeValue: row.lifetime_value,
    giftCount: row.gift_count,
  };
}

function toDonation(row: DonationRow): Donation {
  return {
    id: row.id,
    donorId: row.donor_id,
    date: row.date,
    receivingEntity: row.receiving_entity,
    kind: row.kind,
    itemDescription: row.item_description ?? undefined,
    itemType: row.item_type ?? undefined,
    quantity: row.quantity ?? undefined,
    uomId: row.uom_id ?? undefined,
    unitValue: row.unit_value ?? undefined,
    totalValue: row.total_value,
    currency: row.currency,
    campaignId: row.campaign_id ?? undefined,
    createdInventoryLotId: row.created_inventory_lot_id ?? undefined,
    status: row.status,
  };
}

interface DonorsData {
  donors: Donor[];
  donations: Donation[];
}

export const donorsStore = createCollection<DonorsData>({
  key: "ops.donors",
  empty: { donors: [], donations: [] },
  tables: [
    { schema: "ops", table: "donors" },
    { schema: "ops", table: "donations" },
  ],
  fetch: async () => {
    const supabase = createClient();
    const [donorsRes, donationsRes] = await Promise.all([
      supabase.schema("ops").from("donors").select("*").order("name"),
      supabase.schema("ops").from("donations").select("*").order("date", { ascending: false }),
    ]);
    if (donorsRes.error) throw new Error(donorsRes.error.message);
    if (donationsRes.error) throw new Error(donationsRes.error.message);
    return {
      donors: (donorsRes.data ?? []).map(toDonor),
      donations: (donationsRes.data ?? []).map(toDonation),
    };
  },
});

export function useDonorsData() {
  const {
    data: { donors, donations },
    loading,
  } = useCollection(donorsStore);

  /** Records a new donation. The donor's gift count, lifetime value and first/last gift dates
   * follow by themselves: the database recomputes them from ops.donations (0082). */
  async function addDonation(donation: Omit<Donation, "id">): Promise<MutationResult> {
    const supabase = createClient();
    const donor = donors.find((d) => d.id === donation.donorId);
    if (!donor) return { ok: false, error: "Donor not found" };

    const { error: donationError } = await supabase.schema("ops").from("donations").insert({
      id: crypto.randomUUID(),
      donor_id: donation.donorId,
      date: donation.date,
      receiving_entity: donation.receivingEntity,
      kind: donation.kind,
      item_description: donation.itemDescription ?? null,
      item_type: donation.itemType ?? null,
      quantity: donation.quantity ?? null,
      uom_id: donation.uomId ?? null,
      unit_value: donation.unitValue ?? null,
      total_value: donation.totalValue,
      currency: donation.currency,
      campaign_id: donation.campaignId ?? null,
      status: "finalized",
    });
    if (donationError) return { ok: false, error: donationError.message };

    // ops.campaigns.raised_amount is a stored rollup, not derived at read time --
    // it was previously never incremented anywhere, so every campaign progress bar
    // was stuck at 0.
    if (donation.campaignId) {
      const { data: campaign } = await supabase
        .schema("ops")
        .from("campaigns")
        .select("raised_amount")
        .eq("id", donation.campaignId)
        .single();
      if (campaign) {
        await supabase
          .schema("ops")
          .from("campaigns")
          .update({ raised_amount: Number(campaign.raised_amount) + donation.totalValue })
          .eq("id", donation.campaignId);
      }
    }

    await donorsStore.refetch();
    // The campaign rollup lives in another store; wake it up too.
    if (donation.campaignId) void invalidateTables([{ schema: "ops", table: "campaigns" }]);
    return { ok: true };
  }

  /** Adds a donor (no id) or saves an existing one's details. Input is checked by the caller
   * (lib/utils/donor-details.ts checkDonorInput); the database allows it only for donors editors. */
  async function saveDonor(input: DonorInput, id?: string): Promise<MutationResult & { id?: string }> {
    const row = {
      name: input.name,
      type: input.type,
      tax_jurisdiction: input.taxJurisdiction,
      email: input.email || null,
      phone: input.phone || null,
      tin: input.tin || null,
    };
    const supabase = createClient();
    const res = id
      ? await supabase.schema("ops").from("donors").update(row).eq("id", id).select("id")
      : await supabase.schema("ops").from("donors").insert(row).select("id");
    if (res.error) return { ok: false, error: res.error.message };
    if (!res.data?.length) return { ok: false, error: "You don't have permission to change donors." };
    await donorsStore.refetch();
    return { ok: true, id: res.data[0]!.id as string };
  }

  return { donors, donations, loading, addDonation, saveDonor, refetch: donorsStore.refetch };
}
