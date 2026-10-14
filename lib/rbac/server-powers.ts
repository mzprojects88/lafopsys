import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { Power } from "@/lib/rbac/who";

type Server = Awaited<ReturnType<typeof createClient>>;

/** Does the signed-in person hold this power? Asked of the database (shared.has_power, 0093), so a
 * role an admin just changed counts at once; the Super Admin always does. */
export async function callerHolds(supabase: Server, power: Power): Promise<boolean> {
  const { data } = await supabase.schema("shared").rpc("has_power", { p_power: power });
  return data === true;
}

/** Runs HR: the "Runs HR" power or the person's HR switch (hr.is_hr_staff). */
export async function callerRunsHr(supabase: Server): Promise<boolean> {
  const { data } = await supabase.schema("hr").rpc("is_hr_staff");
  return data === true;
}
