// Connectivity smoke test — confirms NEXT_PUBLIC_SUPABASE_URL /
// NEXT_PUBLIC_SUPABASE_ANON_KEY actually reach the project. Never logs the
// key itself, only pass/fail. Run with:
//   node --env-file=.env.local scripts/check-supabase.mjs
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  process.exit(1);
}

async function check(label, key, path) {
  try {
    const res = await fetch(`${url}${path}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (res.ok) {
      console.log(`OK — ${label} accepted at ${path} (${res.status}).`);
      return true;
    }
    const body = await res.text();
    console.error(`${label} rejected at ${path} (${res.status}): ${body}`);
    return false;
  } catch (err) {
    console.error(`Could not reach ${url}${path}:`, err.message);
    return false;
  }
}

// /rest/v1/ (bare root) requires a secret key on newer Supabase projects — it
// exposes the OpenAPI schema. /auth/v1/settings is the anon-key-safe
// endpoint for a basic reachability + key-validity check.
const anonOk = await check("anon key", anonKey, "/auth/v1/settings");
let serviceOk = true;
if (serviceRoleKey) {
  serviceOk = await check("service_role key", serviceRoleKey, "/rest/v1/");
} else {
  console.log("SUPABASE_SERVICE_ROLE_KEY not set — skipped.");
}

process.exit(anonOk && serviceOk ? 0 : 1);
