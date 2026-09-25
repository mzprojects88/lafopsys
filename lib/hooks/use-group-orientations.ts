"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";

export interface GroupOrientation {
  id: string;
  tripId: string | null;
  rideId: string | null;
  heldAt: string;
  heldBy: string | null;
}

interface Row {
  id: string;
  trip_id: string | null;
  ride_id: string | null;
  held_at: string;
  held_by: string | null;
}

/** House rules talked through with a whole group that arrived together (0065); the last fortnight is plenty. */
export const groupOrientationsStore = createCollection<GroupOrientation[]>({
  key: "ops.group_orientations",
  empty: [],
  tables: [{ schema: "ops", table: "group_orientations" }],
  fetch: async () => {
    const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
    const { data, error } = await createClient().schema("ops").from("group_orientations").select("*").gte("held_at", since);
    if (error) throw new Error(error.message);
    return ((data ?? []) as Row[]).map((r) => ({ id: r.id, tripId: r.trip_id, rideId: r.ride_id, heldAt: r.held_at, heldBy: r.held_by }));
  },
});

export function useGroupOrientations() {
  const { data: sessions } = useCollection(groupOrientationsStore);
  const forGroup = (group: { tripId?: string | null; rideId?: string | null }) =>
    sessions.find((s) => (group.tripId && s.tripId === group.tripId) || (group.rideId && s.rideId === group.rideId));
  return { sessions, forGroup };
}

/** Record that the rules were discussed with this group; a second call for the same group keeps the first. */
export async function recordGroupOrientation(group: { tripId?: string | null; rideId?: string | null }): Promise<void> {
  const row: Record<string, string | null> = group.tripId ? { trip_id: group.tripId } : { ride_id: group.rideId ?? null };
  const { error } = await createClient().schema("ops").from("group_orientations").insert(row);
  if (error && error.code !== "23505") throw new Error(error.message);
  await groupOrientationsStore.refetch();
}
