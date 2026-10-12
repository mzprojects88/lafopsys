"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";

/**
 * When accounting's Donation Tracker last arrived (ops.cash_gift_sources, 0084): one small row,
 * for the bell. The Cash gifts page has its own, fuller store (use-cash-gifts.ts); this one is
 * light enough to load on every page for the people who must hear that the tracker has stopped.
 */
export const cashSourceStatusStore = createCollection<{ trackerReceivedAt: string | null }>({
  key: "ops.cash_gift_sources:tracker",
  empty: { trackerReceivedAt: null },
  tables: [{ schema: "ops", table: "cash_gift_sources" }],
  fetch: async () => {
    const { data, error } = await createClient().schema("ops").from("cash_gift_sources").select("received_at").eq("source", "2026").maybeSingle();
    if (error) throw new Error(error.message);
    return { trackerReceivedAt: (data?.received_at as string | undefined) ?? null };
  },
});

export function useTrackerReceivedAt(): string | null {
  return useCollection(cashSourceStatusStore).data.trackerReceivedAt;
}
