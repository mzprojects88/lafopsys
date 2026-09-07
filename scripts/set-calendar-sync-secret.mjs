// Puts the calendar sync's bearer secret into Supabase Vault, where the
// pg_cron job (migration 0034) reads it at each tick.
//
// The value comes from CALENDAR_SYNC_SECRET in .env.local -- the same value
// that must be set in Vercel's Production environment, since the route
// compares the two. This script never prints it. Re-running rotates the
// stored value if it has changed; rotate the Vercel env at the same time,
// or every scheduled run answers 401 until they match again.
//
// Usage: node --env-file=.env.local scripts/set-calendar-sync-secret.mjs

import { Client } from "pg";

const secret = process.env.CALENDAR_SYNC_SECRET;
const password = process.env.SUPABASE_DB_PASSWORD;
if (!secret || secret.length < 32) {
  console.error("CALENDAR_SYNC_SECRET is missing from .env.local or shorter than 32 characters. Generate one with: openssl rand -hex 32");
  process.exit(1);
}
if (!password) {
  console.error("Missing SUPABASE_DB_PASSWORD in .env.local.");
  process.exit(1);
}

const projectRef = "kptftyuzrnummbcjakro";
const region = "ap-northeast-1";
const client = new Client({
  connectionString: `postgresql://postgres.${projectRef}:${encodeURIComponent(password)}@aws-0-${region}.pooler.supabase.com:5432/postgres`,
});

const NAME = "calendar_sync_secret";

try {
  await client.connect();
  const { rows } = await client.query("select id from vault.secrets where name = $1", [NAME]);
  if (rows.length > 0) {
    await client.query("select vault.update_secret($1::uuid, $2)", [rows[0].id, secret]);
    console.log(`Vault secret ${NAME} updated.`);
  } else {
    await client.query("select vault.create_secret($1, $2, $3)", [secret, NAME, "Bearer token the calendar-sheet-sync cron job sends to /api/calendar/sync"]);
    console.log(`Vault secret ${NAME} created.`);
  }
} catch (err) {
  console.error("Failed:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
