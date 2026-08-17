// One-time migration: moves the real meal-service, Care Cart, and census
// history records (already cleaned by clean-*.py, synced into
// lib/mock-data/real/*.json by sync-real-data.mjs) into
// ops.meal_services/ops.care_cart_logs/ops.census_snapshots.
//
// trips and activity_sessions are NOT migrated here -- lib/mock-data/house-ops.ts
// generates both entirely with `rng` (confirmed by reading the generator), no
// real source data exists for either. Both tables start empty; staff record
// real ones going forward through the app.
//
// Idempotent: meal_services keyed by (date, meal_type), care_cart_logs by
// (date, time_slot, items_served), census_snapshots by date (its real PK).
//
// Usage: node --env-file=.env.local scripts/migrate-house-ops-to-supabase.mjs

import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import realMealServices from "../lib/mock-data/real/meal-services.json" with { type: "json" };
import realCareCartLogs from "../lib/mock-data/real/care-cart-logs.json" with { type: "json" };
import realCensusHistory from "../lib/mock-data/real/census-history.json" with { type: "json" };

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local.");
  process.exit(1);
}

const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
const CHUNK = 100;

async function migrateMealServices() {
  const { data: existing, error } = await admin.schema("ops").from("meal_services").select("date, meal_type");
  if (error) { console.error("Failed to check existing meal_services:", error.message); process.exit(1); }
  const existingKeys = new Set(existing.map((r) => `${r.date}|${r.meal_type}`));

  const rows = realMealServices
    .filter((m) => !existingKeys.has(`${m.date}|${m.mealType}`))
    .map((m) => ({
      id: randomUUID(),
      date: m.date,
      meal_type: m.mealType,
      headcount: m.headcount,
      cost_per_head: m.costPerHead ?? null,
    }));

  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error: insertError } = await admin.schema("ops").from("meal_services").insert(rows.slice(i, i + CHUNK));
    if (insertError) { console.error("meal_services insert failed:", insertError.message); process.exit(1); }
  }
  console.log(`meal_services: inserted ${rows.length}, skipped ${realMealServices.length - rows.length} already present.`);
}

async function migrateCareCartLogs() {
  const { data: existing, error } = await admin.schema("ops").from("care_cart_logs").select("date, time_slot, items_served");
  if (error) { console.error("Failed to check existing care_cart_logs:", error.message); process.exit(1); }
  const existingKeys = new Set(existing.map((r) => `${r.date}|${r.time_slot}|${r.items_served}`));

  const rows = realCareCartLogs
    .filter((c) => !existingKeys.has(`${c.date}|${c.timeSlot}|${c.itemsServed}`))
    .map((c) => ({
      id: randomUUID(),
      date: c.date,
      time_slot: c.timeSlot,
      items_served: c.itemsServed,
      headcount: c.headcount,
      volunteer_id: c.volunteerId ?? null,
      source: c.source ?? null,
    }));

  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error: insertError } = await admin.schema("ops").from("care_cart_logs").insert(rows.slice(i, i + CHUNK));
    if (insertError) { console.error("care_cart_logs insert failed:", insertError.message); process.exit(1); }
  }
  console.log(`care_cart_logs: inserted ${rows.length}, skipped ${realCareCartLogs.length - rows.length} already present.`);
}

async function migrateCensusSnapshots() {
  const { data: existing, error } = await admin.schema("ops").from("census_snapshots").select("date");
  if (error) { console.error("Failed to check existing census_snapshots:", error.message); process.exit(1); }
  const existingDates = new Set(existing.map((r) => r.date));

  const rows = realCensusHistory
    .filter((c) => !existingDates.has(c.date))
    .map((c) => ({
      date: c.date,
      in_house: c.inHouse,
      units_occupied: c.unitsOccupied ?? null,
      units_shared: c.unitsShared ?? null,
      total_units: c.totalUnits,
    }));

  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error: insertError } = await admin.schema("ops").from("census_snapshots").insert(rows.slice(i, i + CHUNK));
    if (insertError) { console.error("census_snapshots insert failed:", insertError.message); process.exit(1); }
  }
  console.log(`census_snapshots: inserted ${rows.length}, skipped ${realCensusHistory.length - rows.length} already present.`);
}

async function main() {
  await migrateMealServices();
  await migrateCareCartLogs();
  await migrateCensusSnapshots();
}

main();
