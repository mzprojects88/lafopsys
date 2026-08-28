// One-time backfill: creates lafopsys accounts for real employees (from
// DATA/Employee Data.xlsx, "Employee 201 Masterlist") who don't have one
// yet. Riza Joy Donasco is deliberately excluded -- resigned, per the
// masterlist's Employment Status column.
//
// Idempotent: safe to re-run. Skips any staff_code that already exists
// rather than resetting its PIN.
//
// Usage: node --env-file=.env.local scripts/create-employee-201-accounts.mjs

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local.");
  process.exit(1);
}

const DEFAULT_PIN = "888888";

const NEW_STAFF = [
  { staffCode: "cathlyn.paglinawan", firstName: "Cathlyn", lastName: "Paglinawan", role: "social_worker", position: "Resident Social Worker" },
  { staffCode: "queenizell.spencer", firstName: "Queen Izell", lastName: "Spencer", role: "social_worker", position: "Resident Social Worker" },
  { staffCode: "christopher.fajardo", firstName: "Christopher", lastName: "Fajardo", role: "driver", position: "Part Time Driver" },
];

const admin = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function createOne(person) {
  const { staffCode, firstName, lastName, role, position } = person;

  const { data: existing, error: lookupError } = await admin
    .schema("shared")
    .from("staff")
    .select("id")
    .eq("staff_code", staffCode)
    .maybeSingle();

  if (lookupError) {
    console.error(`  ${staffCode}: failed to check for an existing account — ${lookupError.message}`);
    return false;
  }

  if (existing) {
    console.log(`  ${staffCode}: already exists (id ${existing.id}) — skipped.`);
    return true;
  }

  const email = `${staffCode.toLowerCase()}@staff.lafopsys.internal`;

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password: DEFAULT_PIN,
    email_confirm: true,
    user_metadata: { staffCode },
  });

  if (createError) {
    console.error(`  ${staffCode}: failed to create the Supabase Auth user — ${createError.message}`);
    return false;
  }

  const { error: insertError } = await admin.schema("shared").from("staff").insert({
    id: created.user.id,
    staff_code: staffCode,
    first_name: firstName,
    last_name: lastName,
    role,
    position,
    active: true,
    must_change_pin: true,
  });

  if (insertError) {
    console.error(`  ${staffCode}: shared.staff insert failed — cleaning up the orphaned auth user — ${insertError.message}`);
    await admin.auth.admin.deleteUser(created.user.id);
    return false;
  }

  console.log(`  ${staffCode}: created (role ${role}, PIN ${DEFAULT_PIN}, must_change_pin set).`);
  return true;
}

async function main() {
  console.log(`Creating ${NEW_STAFF.length} employee account(s)...`);
  let allOk = true;
  for (const person of NEW_STAFF) {
    const ok = await createOne(person);
    if (!ok) allOk = false;
  }
  if (!allOk) process.exit(1);
}

main();
