"use client";

import { createCollection, useCollection } from "@/lib/data/collection-store";
import type { DirectDonation } from "@/lib/direct/direct";
import { createClient } from "@/lib/supabase/client";

/**
 * Donations for patients (LAF-DTP, Inventory 0082) with their progress, for the bell and the dashboard card. Read
 * through inventory.direct_donations, which answers only those who may see them: for anyone else the list is empty.
 * The Direct donations page reads on its own and tells this store when something changed (refetch).
 */
export const directDonationsStore = createCollection<DirectDonation[]>({
  key: "inventory.direct_donations",
  empty: [],
  tables: [{ schema: "inventory", table: "donation_log" }, { schema: "inventory", table: "transactions" }],
  fetch: async () => {
    const { data, error } = await createClient().schema("inventory").rpc("direct_donations", { p_id: null });
    if (error) {
      if (error.code === "42501") return []; // not this person's to see
      throw new Error(error.message);
    }
    return (data ?? []) as DirectDonation[];
  },
});

/** What still has goods to give, and which of those are past the target days (Inventory setting, 7). */
export function useDirectWaiting(enabled: boolean) {
  const { data, loading, error } = useCollection(enabled ? directDonationsStore : null);
  const open = enabled ? (data ?? []).filter((d) => Number(d.left) > 0) : [];
  return { open, late: open.filter((d) => d.overdue), loading: enabled && loading, error: enabled ? error : null };
}
