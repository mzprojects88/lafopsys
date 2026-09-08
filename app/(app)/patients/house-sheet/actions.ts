"use server";

import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/app/(app)/hr/actions";

/**
 * A social worker's or admin's decisions on the house sheet. Every write
 * runs as the caller: 0046's column grant and review trigger decide what a
 * review may change, and the row is signed by whoever made it.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function caller() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." as string, supabase: undefined, userId: undefined };
  const { data: staff } = await supabase.schema("shared").from("staff").select("role, active").eq("id", user.id).maybeSingle();
  if (!staff?.active) return { error: "This staff account is inactive." as string, supabase: undefined, userId: undefined };
  if (!["admin", "social_worker"].includes(staff.role)) return { error: "Only admins and social workers review the house sheet." as string, supabase: undefined, userId: undefined };
  return { error: undefined, supabase, userId: user.id };
}

function readable(message: string, code?: string): string {
  if (code === "42501") return "You cannot change this row.";
  return message;
}

async function review(rowId: string, patch: Record<string, unknown>): Promise<ActionResult> {
  if (!UUID_RE.test(rowId)) return { ok: false, error: "Bad row id." };
  const c = await caller();
  if (c.error !== undefined) return { ok: false, error: c.error };
  const { data, error } = await c.supabase
    .schema("ops")
    .from("house_sheet_people")
    .update({ ...patch, reviewed_by: c.userId })
    .eq("id", rowId)
    .select("id");
  if (error) return { ok: false, error: readable(error.message, error.code) };
  if (!data || data.length === 0) return { ok: false, error: "That row is not available to you." };
  return { ok: true };
}

/** "Yes, this is that patient" -- the suggestion, or one picked from the list. */
export async function confirmHouseSheetMatch(rowId: string, patientId: string): Promise<ActionResult> {
  if (!UUID_RE.test(patientId)) return { ok: false, error: "Bad patient id." };
  const c = await caller();
  if (c.error !== undefined) return { ok: false, error: c.error };
  const { data: row } = await c.supabase.schema("ops").from("house_sheet_people").select("matched_patient_id, match_method").eq("id", rowId).maybeSingle();
  if (!row) return { ok: false, error: "That row is not available to you." };
  const keepsSuggestion = row.matched_patient_id === patientId && row.match_method !== null;
  return review(rowId, { match_status: "confirmed", matched_patient_id: patientId, match_method: keepsSuggestion ? row.match_method : "manual", referral_id: null });
}

/** "Not a patient of ours" (a carer's name typed in the wrong column, a visitor). */
export async function dismissHouseSheetRow(rowId: string): Promise<ActionResult> {
  return review(rowId, { match_status: "dismissed", matched_patient_id: null, match_method: null, referral_id: null });
}

/** Back to the queue: clears the decision so it can be made again. */
export async function reopenHouseSheetRow(rowId: string): Promise<ActionResult> {
  return review(rowId, { match_status: "unmatched", matched_patient_id: null, match_method: null, referral_id: null });
}

/** The row was encoded as a new referral; it follows that referral from here. */
export async function markHouseSheetRowEncoded(rowId: string, referralId: string): Promise<ActionResult> {
  if (!UUID_RE.test(referralId)) return { ok: false, error: "Bad referral id." };
  return review(rowId, { match_status: "encoded", matched_patient_id: null, match_method: null, referral_id: referralId });
}
