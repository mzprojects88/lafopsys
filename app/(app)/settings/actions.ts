"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { HrSettings } from "@/lib/hooks/use-app-settings";

export interface UpdateClockInRequirementResult {
  ok: boolean;
  error?: string;
}

/**
 * Flips shared.app_settings.require_clock_in_for_inventory_roles. The RLS
 * policy on that table is the real backstop (update restricted to
 * shared.current_staff_role() = 'admin'), but checking the caller's role
 * here first gives a clean error message instead of a silent RLS-denied
 * failure — same reasoning as createStaffAccount()'s caller-role check.
 */
export async function updateClockInRequirement(required: boolean): Promise<UpdateClockInRequirementResult> {
  const supabase = await createClient();
  const {
    data: { user: caller },
  } = await supabase.auth.getUser();

  if (!caller) {
    return { ok: false, error: "Not signed in." };
  }

  const { data: callerStaff } = await supabase.schema("shared").from("staff").select("role").eq("id", caller.id).single();

  if (callerStaff?.role !== "admin") {
    return { ok: false, error: "Only admins can change this setting." };
  }

  const { error } = await supabase
    .schema("shared")
    .from("app_settings")
    .update({ require_clock_in_for_inventory_roles: required, updated_at: new Date().toISOString(), updated_by: caller.id })
    .eq("id", true);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/settings");
  return { ok: true };
}

/**
 * Sets the daily overtime threshold (0029). Same shape as the toggle above:
 * RLS on shared.app_settings is the real gate, the role check here only buys
 * a readable error. The bounds match the column's CHECK so a bad value is
 * refused with a sentence rather than a constraint name.
 */
export async function updateOvertimeThreshold(minutes: number): Promise<UpdateClockInRequirementResult> {
  if (!Number.isInteger(minutes) || minutes < 60 || minutes > 1440) {
    return { ok: false, error: "A working day has to be between 1 and 24 hours." };
  }

  const supabase = await createClient();
  const {
    data: { user: caller },
  } = await supabase.auth.getUser();

  if (!caller) {
    return { ok: false, error: "Not signed in." };
  }

  const { data: callerStaff } = await supabase.schema("shared").from("staff").select("role").eq("id", caller.id).single();

  if (callerStaff?.role !== "admin") {
    return { ok: false, error: "Only admins can change this setting." };
  }

  const { error } = await supabase
    .schema("shared")
    .from("app_settings")
    .update({ overtime_threshold_minutes: minutes, updated_at: new Date().toISOString(), updated_by: caller.id })
    .eq("id", true);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/settings");
  return { ok: true };
}

/**
 * Turns the two-hourly Google Sheet sync for the master calendar on or off
 * (0034). Off is the end of the transition: the scheduled job still fires
 * but the route does nothing, and every event becomes editable in the app.
 */
export async function updateCalendarSheetSync(enabled: boolean): Promise<UpdateClockInRequirementResult> {
  const supabase = await createClient();
  const {
    data: { user: caller },
  } = await supabase.auth.getUser();

  if (!caller) {
    return { ok: false, error: "Not signed in." };
  }

  const { data: callerStaff } = await supabase.schema("shared").from("staff").select("role").eq("id", caller.id).single();

  if (callerStaff?.role !== "admin") {
    return { ok: false, error: "Only admins can change this setting." };
  }

  const { error } = await supabase
    .schema("shared")
    .from("app_settings")
    .update({ calendar_sheet_sync_enabled: enabled, updated_at: new Date().toISOString(), updated_by: caller.id })
    .eq("id", true);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/settings");
  revalidatePath("/calendar");
  return { ok: true };
}

/**
 * Saves the org-wide HR numbers (0038) in one go. Bounds match the columns'
 * CHECKs so a bad value is refused with a sentence. Admin-only like the
 * rest of this table; HR people edit reference data under /hr/settings,
 * not the foundation's pay policy.
 */
export async function updateHrSettings(input: HrSettings): Promise<UpdateClockInRequirementResult> {
  const rule = input.payDateRule;
  if (rule.kind === "offset") {
    if (!Number.isInteger(rule.days) || rule.days < 0 || rule.days > 15) {
      return { ok: false, error: "Pay date offset has to be between 0 and 15 days after the cutoff." };
    }
  } else if (rule.kind === "fixed") {
    for (const d of [rule.first, rule.second]) {
      if (!Number.isInteger(d) || d < 1 || d > 31) return { ok: false, error: "Fixed pay dates have to be a day of the month (1-31)." };
    }
  } else {
    return { ok: false, error: "Unknown pay date rule." };
  }
  if (input.contributionCutoff !== "second" && input.contributionCutoff !== "split") {
    return { ok: false, error: "Contribution cutoff must be 'second' or 'split'." };
  }
  if (!Number.isInteger(input.tardinessGraceMinutes) || input.tardinessGraceMinutes < 0 || input.tardinessGraceMinutes > 60) {
    return { ok: false, error: "Grace period has to be between 0 and 60 minutes." };
  }
  for (const [label, v] of [
    ["Vacation leave", input.vlDaysPerYear],
    ["Sick leave", input.slDaysPerYear],
  ] as const) {
    if (!Number.isFinite(v) || v < 0 || v > 60 || Math.round(v * 2) !== v * 2) {
      return { ok: false, error: `${label} has to be between 0 and 60 days, in half days.` };
    }
  }
  const region = input.minimumWageRegion.trim().toUpperCase();
  if (!/^[A-Z0-9-]{1,20}$/.test(region)) return { ok: false, error: "Region should be a short code like NCR." };

  const supabase = await createClient();
  const {
    data: { user: caller },
  } = await supabase.auth.getUser();
  if (!caller) return { ok: false, error: "Not signed in." };

  const { data: callerStaff } = await supabase.schema("shared").from("staff").select("role").eq("id", caller.id).single();
  if (callerStaff?.role !== "admin") return { ok: false, error: "Only admins can change HR settings." };

  const { error } = await supabase
    .schema("shared")
    .from("app_settings")
    .update({
      payroll_pay_date_rule: rule,
      payroll_contribution_cutoff: input.contributionCutoff,
      tardiness_grace_minutes: input.tardinessGraceMinutes,
      leave_vl_days_per_year: input.vlDaysPerYear,
      leave_sl_days_per_year: input.slDaysPerYear,
      leave_vl_convertible: input.vlConvertible,
      minimum_wage_region: region,
      updated_at: new Date().toISOString(),
      updated_by: caller.id,
    })
    .eq("id", true);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings");
  revalidatePath("/hr");
  return { ok: true };
}
