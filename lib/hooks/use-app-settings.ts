"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";
import { DEFAULT_OVERTIME_THRESHOLD_MINUTES } from "@/lib/utils/dtr";

/** When a semi-monthly cutoff is paid (0038). */
export type PayDateRule = { kind: "offset"; days: number } | { kind: "fixed"; first: number; second: number };
export type ContributionCutoff = "second" | "split";

export interface HrSettings {
  payDateRule: PayDateRule;
  /** Whether the month's SSS/PhilHealth/Pag-IBIG come off the second cutoff or are split. */
  contributionCutoff: ContributionCutoff;
  tardinessGraceMinutes: number;
  vlDaysPerYear: number;
  slDaysPerYear: number;
  vlConvertible: boolean;
  minimumWageRegion: string;
}

export interface AppSettings extends HrSettings {
  requireClockInForInventoryRoles: boolean;
  /** Minutes in a normal working day; anything beyond is overtime (0029).
   * Read by every screen that splits regular from overtime hours. */
  overtimeThresholdMinutes: number;
  /** While true the master calendar follows the Google Sheet every two hours
   * and sheet events are read-only in the app (0034). Off ends that. */
  calendarSheetSyncEnabled: boolean;
}

interface AppSettingsRow {
  require_clock_in_for_inventory_roles: boolean;
  overtime_threshold_minutes: number;
  calendar_sheet_sync_enabled: boolean;
  payroll_pay_date_rule: PayDateRule | null;
  payroll_contribution_cutoff: ContributionCutoff;
  tardiness_grace_minutes: number;
  leave_vl_days_per_year: number | string;
  leave_sl_days_per_year: number | string;
  leave_vl_convertible: boolean;
  minimum_wage_region: string;
}

export const HR_SETTINGS_DEFAULTS: HrSettings = {
  payDateRule: { kind: "offset", days: 5 },
  contributionCutoff: "second",
  tardinessGraceMinutes: 0,
  vlDaysPerYear: 5,
  slDaysPerYear: 5,
  vlConvertible: true,
  minimumWageRegion: "NCR",
};

const DEFAULTS: AppSettings = {
  requireClockInForInventoryRoles: false,
  overtimeThresholdMinutes: DEFAULT_OVERTIME_THRESHOLD_MINUTES,
  calendarSheetSyncEnabled: true,
  ...HR_SETTINGS_DEFAULTS,
};

const SELECT =
  "require_clock_in_for_inventory_roles, overtime_threshold_minutes, calendar_sheet_sync_enabled, " +
  "payroll_pay_date_rule, payroll_contribution_cutoff, tardiness_grace_minutes, " +
  "leave_vl_days_per_year, leave_sl_days_per_year, leave_vl_convertible, minimum_wage_region";

export const appSettingsStore = createCollection<AppSettings>({
  key: "shared.app_settings",
  empty: DEFAULTS,
  tables: [{ schema: "shared", table: "app_settings" }],
  fetch: async () => {
    const { data, error } = await createClient().schema("shared").from("app_settings").select(SELECT).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return DEFAULTS;
    const row = data as unknown as AppSettingsRow;
    return {
      requireClockInForInventoryRoles: row.require_clock_in_for_inventory_roles,
      overtimeThresholdMinutes: row.overtime_threshold_minutes,
      calendarSheetSyncEnabled: row.calendar_sheet_sync_enabled,
      payDateRule: row.payroll_pay_date_rule ?? HR_SETTINGS_DEFAULTS.payDateRule,
      contributionCutoff: row.payroll_contribution_cutoff,
      tardinessGraceMinutes: row.tardiness_grace_minutes,
      vlDaysPerYear: Number(row.leave_vl_days_per_year),
      slDaysPerYear: Number(row.leave_sl_days_per_year),
      vlConvertible: row.leave_vl_convertible,
      minimumWageRegion: row.minimum_wage_region,
    };
  },
});

/** Read-only view of the single-row shared.app_settings table. Any
 * authenticated staff member can read it; only admins can write it (see
 * app/(app)/settings/actions.ts). */
export function useAppSettings() {
  const { data, loading } = useCollection(appSettingsStore);
  return { ...data, loading, refetch: appSettingsStore.refetch };
}
