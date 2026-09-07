"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";
import { DEFAULT_OVERTIME_THRESHOLD_MINUTES } from "@/lib/utils/dtr";

export interface AppSettings {
  requireClockInForInventoryRoles: boolean;
  /** Minutes in a normal working day; anything beyond is overtime (0029).
   * Read by every screen that splits regular from overtime hours. */
  overtimeThresholdMinutes: number;
}

interface AppSettingsRow {
  require_clock_in_for_inventory_roles: boolean;
  overtime_threshold_minutes: number;
}

const DEFAULTS: AppSettings = {
  requireClockInForInventoryRoles: false,
  overtimeThresholdMinutes: DEFAULT_OVERTIME_THRESHOLD_MINUTES,
};

export const appSettingsStore = createCollection<AppSettings>({
  key: "shared.app_settings",
  empty: DEFAULTS,
  tables: [{ schema: "shared", table: "app_settings" }],
  fetch: async () => {
    const { data, error } = await createClient()
      .schema("shared")
      .from("app_settings")
      .select("require_clock_in_for_inventory_roles, overtime_threshold_minutes")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return DEFAULTS;
    const row = data as AppSettingsRow;
    return {
      requireClockInForInventoryRoles: row.require_clock_in_for_inventory_roles,
      overtimeThresholdMinutes: row.overtime_threshold_minutes,
    };
  },
});

/** Read-only view of the single-row shared.app_settings table. Any
 * authenticated staff member can read it; only admins can write it (see
 * app/(app)/settings/actions.ts's updateClockInRequirement). */
export function useAppSettings() {
  const { data, loading } = useCollection(appSettingsStore);
  return { ...data, loading, refetch: appSettingsStore.refetch };
}
