"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";
import type { CareCartLog } from "@/lib/types/house-ops";

export type MutationResult = { ok: true } | { ok: false; error: string };

interface CareCartLogRow {
  id: string;
  date: string;
  time_slot: string;
  items_served: string;
  headcount: number;
  volunteer_id: string | null;
  source: "LAF Pantry" | "Donation" | null;
}

function toCareCartLog(row: CareCartLogRow): CareCartLog {
  return {
    id: row.id,
    date: row.date,
    timeSlot: row.time_slot as CareCartLog["timeSlot"],
    itemsServed: row.items_served,
    headcount: row.headcount,
    volunteerId: row.volunteer_id ?? undefined,
    source: row.source ?? undefined,
  };
}

export const careCartStore = createCollection<CareCartLog[]>({
  key: "ops.care_cart_logs",
  empty: [],
  tables: [{ schema: "ops", table: "care_cart_logs" }],
  fetch: async () => {
    const supabase = createClient();
    const { data, error } = await supabase.schema("ops").from("care_cart_logs").select("*").order("date", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map(toCareCartLog);
  },
});

export function useCareCartData() {
  const { data: logs, loading } = useCollection(careCartStore);

  async function addLog(log: Omit<CareCartLog, "id">): Promise<MutationResult> {
    const supabase = createClient();
    const { error } = await supabase.schema("ops").from("care_cart_logs").insert({
      id: crypto.randomUUID(),
      date: log.date,
      time_slot: log.timeSlot,
      items_served: log.itemsServed,
      headcount: log.headcount,
      volunteer_id: log.volunteerId ?? null,
      source: log.source ?? null,
    });
    if (error) return { ok: false, error: error.message };
    await careCartStore.refetch();
    return { ok: true };
  }

  return { logs, loading, addLog, refetch: careCartStore.refetch };
}
