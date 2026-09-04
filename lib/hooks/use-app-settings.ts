"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";

export interface AppSettings {
  requireClockInForInventoryRoles: boolean;
}

interface AppSettingsRow {
  require_clock_in_for_inventory_roles: boolean;
}

const DEFAULTS: AppSettings = { requireClockInForInventoryRoles: false };

export const appSettingsStore = createCollection<AppSettings>({
  key: "shared.app_settings",
  empty: DEFAULTS,
  tables: [{ schema: "shared", table: "app_settings" }],
  fetch: async () => {
    const { data, error } = await createClient()
      .schema("shared")
      .from("app_settings")
      .select("require_clock_in_for_inventory_roles")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? { requireClockInForInventoryRoles: (data as AppSettingsRow).require_clock_in_for_inventory_roles } : DEFAULTS;
  },
});

/** Read-only view of the single-row shared.app_settings table. Any
 * authenticated staff member can read it; only admins can write it (see
 * app/(app)/settings/actions.ts's updateClockInRequirement). */
export function useAppSettings() {
  const { data, loading } = useCollection(appSettingsStore);
  return { ...data, loading, refetch: appSettingsStore.refetch };
}
