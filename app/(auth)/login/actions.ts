"use server";

import { recordLoginAttempt, tooManyFailedAttempts } from "@/lib/auth/login-attempts";
import { isPartnerRole } from "@/lib/rbac/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { clearRateLimit, isRateLimited } from "@/lib/utils/rate-limit";

export type SignInResult =
  | {
      ok: true;
      staffId: string;
      role: string;
      extraRoles: string[];
      name: string;
      mustChangePin: boolean;
      landingPath: string | null;
    }
  | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PIN = /^\d{6}$/;
const MAX_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MS = 15 * 60_000;

// The same message for every failure, so the form never confirms which accounts exist or what state they are in.
const GENERIC_FAILURE = "Incorrect PIN. Please try again.";

/**
 * Signs a staff member in from the PIN screen, as laf-inventory does: on the server, so the account's
 * email is looked up here and never reaches the browser, and limited per account. The lockout is on
 * inventory.login_attempts, shared with laf-inventory and the manuals, so 5 wrong PINs across them lock
 * the account for 15 minutes in all three.
 */
export async function signInWithPin(input: { staffId: string; pin: string }): Promise<SignInResult> {
  const staffId = input.staffId?.trim() ?? "";
  const pin = input.pin ?? "";
  if (!UUID.test(staffId) || !PIN.test(pin)) return { ok: false, error: GENERIC_FAILURE };

  const limiterKey = `login:${staffId.toLowerCase()}`;
  const LOCKED = "Too many attempts. Wait 15 minutes and try again.";
  if (isRateLimited(limiterKey, MAX_ATTEMPTS, ATTEMPT_WINDOW_MS)) return { ok: false, error: LOCKED };
  if (await tooManyFailedAttempts(staffId)) return { ok: false, error: LOCKED };

  const admin = createAdminClient();
  const [{ data: staff }, { data: authUser }] = await Promise.all([
    admin.schema("shared").from("staff").select("role, extra_roles, active, first_name, last_name, must_change_pin, landing_path").eq("id", staffId).maybeSingle(),
    admin.auth.admin.getUserById(staffId),
  ]);
  const email = authUser?.user?.email;
  // An outside (partner) account signs in to Inventory only; a donor has no staff row.
  if (!staff || !staff.active || isPartnerRole(staff.role) || !email) return { ok: false, error: GENERIC_FAILURE };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password: pin });
  if (error) {
    await recordLoginAttempt(staffId, false);
    return { ok: false, error: GENERIC_FAILURE };
  }

  await recordLoginAttempt(staffId, true);
  clearRateLimit(limiterKey);
  return {
    ok: true,
    staffId,
    role: staff.role,
    extraRoles: (staff.extra_roles as string[] | null) ?? [],
    name: `${staff.first_name} ${staff.last_name}`,
    mustChangePin: Boolean(staff.must_change_pin),
    landingPath: (staff.landing_path as string | null) ?? null,
  };
}
