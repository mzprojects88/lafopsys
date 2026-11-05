import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export const MAX_FAILED_ATTEMPTS = 5;
export const ATTEMPT_WINDOW_MS = 15 * 60_000;

/**
 * Durable counterpart to the in-memory limiter in lib/utils/rate-limit.ts,
 * backed by inventory.login_attempts (0021) so the count survives serverless
 * cold starts and spans instances. Reads fail open: a database hiccup must
 * never lock every staff member out of the app, and the in-memory limiter is
 * still in front of this one.
 */
export async function tooManyFailedAttempts(staffId: string): Promise<boolean> {
  const since = new Date(Date.now() - ATTEMPT_WINDOW_MS).toISOString();
  const { count, error } = await createAdminClient()
    .schema("inventory")
    .from("login_attempts")
    .select("id", { count: "exact", head: true })
    .eq("staff_id", staffId)
    .eq("succeeded", false)
    .gte("attempted_at", since);
  if (error) return false;
  return (count ?? 0) >= MAX_FAILED_ATTEMPTS;
}

/** Records the outcome. A success also clears that account's failed history,
 * so an old string of typos doesn't count against the next lockout window. */
export async function recordLoginAttempt(staffId: string, succeeded: boolean): Promise<void> {
  const admin = createAdminClient().schema("inventory");
  await admin.from("login_attempts").insert({ staff_id: staffId, succeeded });
  if (succeeded) {
    await admin.from("login_attempts").delete().eq("staff_id", staffId).eq("succeeded", false);
  }
}
