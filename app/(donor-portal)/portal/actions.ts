"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export interface CompleteDonorPasswordChangeResult {
  ok: boolean;
  error?: string;
}

/**
 * Clears shared.donor_accounts.must_change_password after a donor sets a
 * real password. Donors have no UPDATE policy of their own on this table
 * (see supabase/migrations/0022_donor_accounts.sql) -- RLS can restrict
 * which rows an UPDATE touches but not which columns, so a same-shape "own
 * row" policy would also let a donor overwrite donor_id and hijack
 * shared.current_donor_id() into reading someone else's data. This action
 * uses the service-role client instead, after confirming the caller
 * genuinely has a donor account.
 */
export async function completeDonorPasswordChange(): Promise<CompleteDonorPasswordChangeResult> {
  const supabase = await createClient();
  const {
    data: { user: caller },
  } = await supabase.auth.getUser();

  if (!caller) {
    return { ok: false, error: "Not signed in." };
  }

  const { data: account } = await supabase.schema("shared").from("donor_accounts").select("id").eq("id", caller.id).single();

  if (!account) {
    return { ok: false, error: "No donor portal account found for this session." };
  }

  const admin = createAdminClient();
  const { error } = await admin.schema("shared").from("donor_accounts").update({ must_change_password: false }).eq("id", caller.id);

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true };
}
