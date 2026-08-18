// One-time migration: moves the real monthly metric snapshots (6 rows,
// produced in integrate.md Step 3, synced into
// lib/mock-data/real/metric-snapshots.json) into ops.metric_snapshots.
//
// Idempotent: date is the real primary key, upsert on conflict.
//
// Usage: node --env-file=.env.local scripts/migrate-metric-snapshots-to-supabase.mjs

import { createClient } from "@supabase/supabase-js";
import realMetricSnapshots from "../lib/mock-data/real/metric-snapshots.json" with { type: "json" };

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local.");
  process.exit(1);
}

const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

async function main() {
  const rows = realMetricSnapshots.map((m) => ({
    date: m.date,
    bed_nights: m.bedNights,
    meals: m.meals,
    trips: m.trips,
    care_cart_meals: m.careCartMeals,
    activity_participants: m.activityParticipants,
    donations_ytd: m.donationsYtd,
  }));

  const { error } = await admin.schema("ops").from("metric_snapshots").upsert(rows, { onConflict: "date" });
  if (error) {
    console.error("Upsert failed:", error.message);
    process.exit(1);
  }
  console.log(`[ok] upserted ${rows.length} metric_snapshots rows`);

  const { count } = await admin.schema("ops").from("metric_snapshots").select("*", { count: "exact", head: true });
  console.log(`[ok] ops.metric_snapshots now has ${count} rows`);
}

main();
