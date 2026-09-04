"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";
import type { Role } from "@/lib/types/common";

export interface StaffRosterEntry {
  id: string;
  firstName: string;
  lastName: string;
  role: Role;
  position: string;
  active: boolean;
}

interface StaffRow {
  id: string;
  first_name: string;
  last_name: string;
  role: Role;
  position: string;
  active: boolean;
}

export const staffRosterStore = createCollection<StaffRosterEntry[]>({
  key: "shared.staff",
  empty: [],
  tables: [{ schema: "shared", table: "staff" }],
  fetch: async () => {
    const { data, error } = await createClient()
      .schema("shared")
      .from("staff")
      .select("id, first_name, last_name, role, position, active")
      .order("first_name");
    if (error) throw new Error(error.message);
    return ((data ?? []) as StaffRow[]).map((row) => ({
      id: row.id,
      firstName: row.first_name,
      lastName: row.last_name,
      role: row.role,
      position: row.position,
      active: row.active,
    }));
  },
});

/** Read-only real `shared.staff` roster, for client-side pickers (trip driver,
 * timesheet reviewer, etc.) that need real staff identities, not mock ones. */
export function useStaffRoster() {
  const { data: staff, loading } = useCollection(staffRosterStore);
  return { staff, loading, refetch: staffRosterStore.refetch };
}
