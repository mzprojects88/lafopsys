"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";
import type { Role } from "@/lib/types/common";

export interface StaffRosterEntry {
  id: string;
  firstName: string;
  lastName: string;
  role: Role;
  active: boolean;
}

interface StaffRow {
  id: string;
  first_name: string;
  last_name: string;
  role: Role;
  active: boolean;
}

/** Read-only real `shared.staff` roster, for client-side pickers (trip driver,
 * timesheet reviewer, etc.) that need real staff identities, not mock ones. */
export function useStaffRoster() {
  const [staff, setStaff] = React.useState<StaffRosterEntry[]>([]);
  const [loading, setLoading] = React.useState(true);

  const refetch = React.useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .schema("shared")
      .from("staff")
      .select("id, first_name, last_name, role, active")
      .order("first_name");
    setStaff(
      ((data ?? []) as StaffRow[]).map((row) => ({
        id: row.id,
        firstName: row.first_name,
        lastName: row.last_name,
        role: row.role,
        active: row.active,
      }))
    );
    setLoading(false);
  }, []);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from Supabase, an external system
    refetch();
  }, [refetch]);

  return { staff, loading, refetch };
}
