import { createBrowserClient } from "@supabase/ssr";
import { supabaseUrl, supabaseAnonKey } from "@/lib/supabase/env";

/** Browser-side client — safe to use in Client Components. Respects RLS via the anon key. */
export function createClient() {
  return createBrowserClient(supabaseUrl(), supabaseAnonKey());
}
