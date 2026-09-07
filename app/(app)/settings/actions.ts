"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

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
