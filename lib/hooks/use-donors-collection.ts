"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";
import type { Donor, Donation } from "@/lib/types/donor";

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
  };
}

export function useDonorsData() {
  const [donors, setDonors] = React.useState<Donor[]>([]);
  const [donations, setDonations] = React.useState<Donation[]>([]);
  const [loading, setLoading] = React.useState(true);

  const refetch = React.useCallback(async () => {
    const supabase = createClient();
    const [donorsRes, donationsRes] = await Promise.all([
      supabase.schema("ops").from("donors").select("*").order("name"),
      supabase.schema("ops").from("donations").select("*").order("date", { ascending: false }),
    ]);
    setDonors((donorsRes.data ?? []).map(toDonor));
    setDonations((donationsRes.data ?? []).map(toDonation));
    setLoading(false);
  }, []);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from Supabase, an external system
    refetch();
  }, [refetch]);

  /** Records a new donation and updates the donor's rolled-up gift_count/lifetime_value/
   * last_gift_date to match -- these are stored aggregates on ops.donors, not derived at
   * read time, so they need to move together with every new donation. */
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

    const { error: donorError } = await supabase
      .schema("ops")
      .from("donors")
      .update({
        gift_count: donor.giftCount + 1,
        lifetime_value: donor.lifetimeValue + donation.totalValue,
        last_gift_date: donation.date > donor.lastGiftDate ? donation.date : donor.lastGiftDate,
        first_gift_date: donor.firstGiftDate && donor.firstGiftDate < donation.date ? donor.firstGiftDate : donation.date,
      })
      .eq("id", donation.donorId);
    if (donorError) return { ok: false, error: donorError.message };

    await refetch();
    return { ok: true };
  }

  return { donors, donations, loading, addDonation, refetch };
}
