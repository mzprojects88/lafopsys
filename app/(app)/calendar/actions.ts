"use server";

import { createClient } from "@/lib/supabase/server";

export interface RestoreResult {
  ok: boolean;
  error?: string;
}

/**
 * Puts back an event the sync hid because the sheet dropped it (0034).
 *
 * For accidents: the next sync hides it again unless the row is back in
 * the sheet, and the log page says so. Runs as the caller -- the calendar's
 * RLS already lets admins update rows -- with the role check here only for
 * a readable refusal.
 */
export async function restoreSheetEvent(id: string): Promise<RestoreResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data: staff } = await supabase.schema("shared").from("staff").select("role").eq("id", user.id).single();
  if (staff?.role !== "admin") return { ok: false, error: "Only admins can restore a hidden event." };

  const { error } = await supabase
    .schema("ops")
    .from("calendar_events")
    .update({ sheet_removed_at: null, updated_by: user.id })
    .eq("id", id)
    .not("sheet_removed_at", "is", null);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
