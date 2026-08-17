// One-time bootstrap: creates the first real admin account, using
// SUPERUSER/SUPERUSER_PIN from .env.local. Solves the chicken-and-egg problem
// that no UI can create the first admin before an admin exists to use it.
//
// After this runs once, SUPERUSER/SUPERUSER_PIN are no longer read by
// anything -- the resulting account is a normal shared.staff row like any
// other, authenticated through the same real Supabase Auth path as everyone
// else. These env vars are never checked at runtime as hardcoded credentials.
//
// Idempotent: safe to re-run. If the account already exists, it reports that
// and exits without changing anything (does not reset the PIN -- use the
// app's real "reset PIN" admin action for that once it exists).
//
// Usage: node --env-file=.env.local scripts/seed-super-admin.mjs

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const superuser = process.env.SUPERUSER;
const superuserPin = process.env.SUPERUSER_PIN;

if (!url || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local.");
  process.exit(1);
}
if (!superuser || !superuserPin) {
  console.error("Missing SUPERUSER or SUPERUSER_PIN in .env.local — nothing to seed.");
  process.exit(1);
}
if (!/^\d{6}$/.test(superuserPin)) {
  console.error("SUPERUSER_PIN must be exactly 6 digits (Supabase Auth's password minimum, and matches the app's PIN length).");
  process.exit(1);
}

const staffCode = superuser.trim();
const email = `${staffCode.toLowerCase()}@staff.lafopsys.internal`;

const admin = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const { data: existing, error: lookupError } = await admin
    .schema("shared")
    .from("staff")
    .select("id, staff_code")
    .eq("staff_code", staffCode)
    .maybeSingle();

  if (lookupError) {
    console.error("Failed to check for an existing account:", lookupError.message);
    process.exit(1);
  }

  if (existing) {
    console.log(`Staff account "${staffCode}" already exists (id ${existing.id}) — nothing to do.`);
    console.log("To reset its PIN, use the app's admin PIN-reset action once it exists, not this script.");
    return;
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password: superuserPin,
    email_confirm: true,
    user_metadata: { staffCode },
  });

  if (createError) {
    console.error("Failed to create the Supabase Auth user:", createError.message);
    process.exit(1);
  }

  const { error: insertError } = await admin.schema("shared").from("staff").insert({
    id: created.user.id,
    staff_code: staffCode,
    first_name: "Super",
    last_name: "Admin",
    role: "admin",
    position: "Super Admin",
    active: true,
    must_change_pin: true,
  });

  if (insertError) {
    console.error("Auth user created but shared.staff insert failed — cleaning up the orphaned auth user:", insertError.message);
    await admin.auth.admin.deleteUser(created.user.id);
    process.exit(1);
  }

  console.log(`Created super admin "${staffCode}" (login email: ${email}).`);
  console.log("must_change_pin is set — they'll be forced to set a new PIN on first login.");
}

main();
