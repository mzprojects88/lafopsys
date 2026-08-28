"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";

export interface AppSettings {
  requireClockInForInventoryRoles: boolean;
}

interface AppSettingsRow {
  require_clock_in_for_inventory_roles: boolean;
}

/** Read-only view of the single-row shared.app_settings table. Any
 * authenticated staff member can read it; only admins can write it (see
 * app/(app)/settings/actions.ts's updateClockInRequirement). */
export function useAppSettings() {
  const [settings, setSettings] = React.useState<AppSettings>({ requireClockInForInventoryRoles: false });
  const [loading, setLoading] = React.useState(true);

  const refetch = React.useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.schema("shared").from("app_settings").select("require_clock_in_for_inventory_roles").single();
    if (data) {
      setSettings({ requireClockInForInventoryRoles: (data as AppSettingsRow).require_clock_in_for_inventory_roles });
    }
    setLoading(false);
  }, []);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from Supabase, an external system
    refetch();
  }, [refetch]);

  return { ...settings, loading, refetch };
}
