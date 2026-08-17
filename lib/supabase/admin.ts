import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { supabaseUrl, supabaseServiceRoleKey } from "@/lib/supabase/env";

/**
 * Service-role client — full DB access, bypasses RLS entirely. Server-only
 * (the `server-only` import throws a build error if this is ever imported
 * from a Client Component). Reserve for admin operations (creating staff
 * accounts, resetting a PIN) — never per-request user logic, use
 * lib/supabase/server.ts for that.
 */
export function createAdminClient() {
  return createSupabaseClient(supabaseUrl(), supabaseServiceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
