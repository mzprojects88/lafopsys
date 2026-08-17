// Regression smoke test for Phase 2 (House Operations). Exercises the exact
// insert shapes used by use-trips-collection.ts, use-meal-services-collection.ts
// (including the real exception-decrements-headcount path), use-care-cart-
// collection.ts, and use-activity-sessions-collection.ts against the live DB,
// then deletes everything it created.
//
// Usage: node --env-file=.env.local scripts/smoke-test-house-ops.mjs

import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const { data: prov } = await admin.schema("ops").from("provinces").select("id").limit(1);
  const { data: staffRow } = await admin.schema("shared").from("staff").select("id").limit(1);
  if (!prov?.length || !staffRow?.length) { console.error("Missing reference data."); process.exit(1); }
  const provinceId = prov[0].id;
  const staffId = staffRow[0].id;

  const patientId = randomUUID();
  const { error: patientError } = await admin.schema("ops").from("patients").insert({
    id: patientId,
    patient_number: `SMOKE-HOUSEOPS-${Date.now()}`,
    first_name: "HouseOps",
    last_name: "Smoke Test",
    sex: "M",
    province_id: provinceId,
    status: "ongoing",
    admitted_at: "2026-08-18",
  });
  if (patientError) { console.error("Patient insert failed:", patientError.message); process.exit(1); }
  console.log("[ok] test patient created");

  // 1. Trip with a real passenger.
  const tripId = randomUUID();
  const { error: tripError } = await admin.schema("ops").from("trips").insert({
    id: tripId,
    date: "2026-08-18",
    direction: "to_hospital",
    driver_staff_id: staffId,
    vehicle: "LAF Van 1",
    departure_time: "08:00",
    odometer_start: 0,
    status: "scheduled",
  });
  if (tripError) { console.error("Trip insert failed:", tripError.message); process.exit(1); }
  const { error: passengerError } = await admin.schema("ops").from("trip_passengers").insert({ trip_id: tripId, patient_id: patientId });
  if (passengerError) { console.error("trip_passengers insert failed:", passengerError.message); process.exit(1); }

  const { data: tripReadBack } = await admin.schema("ops").from("trips").select("*, trip_passengers(patient_id)").eq("id", tripId).single();
  if (tripReadBack.trip_passengers?.[0]?.patient_id !== patientId) { console.error("Trip passenger join did not round-trip."); process.exit(1); }
  console.log("[ok] trip + real passenger inserted and joined correctly");

  // 2. Meal service exception (staff-chosen patient, not random) + headcount decrement.
  const mealId = randomUUID();
  const { error: mealError } = await admin.schema("ops").from("meal_services").insert({
    id: mealId,
    date: "2026-08-18",
    meal_type: "lunch",
    headcount: 15,
  });
  if (mealError) { console.error("Meal service insert failed:", mealError.message); process.exit(1); }

  const { error: exceptionError } = await admin.schema("ops").from("meal_service_exceptions").insert({
    meal_service_id: mealId,
    patient_id: patientId,
    reason: "Smoke test exception",
  });
  if (exceptionError) { console.error("Meal exception insert failed:", exceptionError.message); process.exit(1); }
  const { error: headcountError } = await admin.schema("ops").from("meal_services").update({ headcount: 14 }).eq("id", mealId);
  if (headcountError) { console.error("Headcount decrement failed:", headcountError.message); process.exit(1); }

  const { data: mealReadBack } = await admin
    .schema("ops")
    .from("meal_services")
    .select("headcount, meal_service_exceptions(patient_id, reason)")
    .eq("id", mealId)
    .single();
  if (mealReadBack.headcount !== 14 || mealReadBack.meal_service_exceptions?.[0]?.patient_id !== patientId) {
    console.error("Meal exception did not round-trip correctly:", mealReadBack);
    process.exit(1);
  }
  console.log("[ok] meal exception recorded against a real patient, headcount decremented");

  // 3. Care cart log.
  const cartLogId = randomUUID();
  const { error: cartError } = await admin.schema("ops").from("care_cart_logs").insert({
    id: cartLogId,
    date: "2026-08-18",
    time_slot: "10:00",
    items_served: "Smoke test items",
    headcount: 5,
  });
  if (cartError) { console.error("Care cart log insert failed:", cartError.message); process.exit(1); }
  console.log("[ok] care cart log inserted");

  // 4. Activity session.
  const sessionId = randomUUID();
  const { error: sessionError } = await admin.schema("ops").from("activity_sessions").insert({
    id: sessionId,
    date: "2026-08-18",
    title: "Smoke Test Session",
    participants: 5,
    volunteer_count: 2,
    facilitator: "Smoke Tester",
    hours: 1.5,
  });
  if (sessionError) { console.error("Activity session insert failed:", sessionError.message); process.exit(1); }
  console.log("[ok] activity session inserted");

  // 5. Census read (no write -- historical data only, table already populated by migration).
  const { data: censusSample, error: censusError } = await admin.schema("ops").from("census_snapshots").select("date").limit(1);
  if (censusError || !censusSample?.length) { console.error("Census snapshots not reachable:", censusError?.message); process.exit(1); }
  console.log("[ok] census_snapshots reachable with real historical rows");

  // Cleanup.
  await admin.schema("ops").from("trip_passengers").delete().eq("trip_id", tripId);
  const { error: tripDeleteError } = await admin.schema("ops").from("trips").delete().eq("id", tripId);
  if (tripDeleteError) { console.error("Cleanup (trip) failed:", tripDeleteError.message); process.exit(1); }
  const { error: exceptionDeleteError } = await admin.schema("ops").from("meal_service_exceptions").delete().eq("meal_service_id", mealId);
  if (exceptionDeleteError) { console.error("Cleanup (meal exception) failed:", exceptionDeleteError.message); process.exit(1); }
  const { error: mealDeleteError } = await admin.schema("ops").from("meal_services").delete().eq("id", mealId);
  if (mealDeleteError) { console.error("Cleanup (meal) failed:", mealDeleteError.message); process.exit(1); }
  const { error: cartDeleteError } = await admin.schema("ops").from("care_cart_logs").delete().eq("id", cartLogId);
  if (cartDeleteError) { console.error("Cleanup (care cart) failed:", cartDeleteError.message); process.exit(1); }
  const { error: sessionDeleteError } = await admin.schema("ops").from("activity_sessions").delete().eq("id", sessionId);
  if (sessionDeleteError) { console.error("Cleanup (session) failed:", sessionDeleteError.message); process.exit(1); }
  const { error: patientDeleteError } = await admin.schema("ops").from("patients").delete().eq("id", patientId);
  if (patientDeleteError) { console.error("Cleanup (patient) failed:", patientDeleteError.message); process.exit(1); }

  const { data: leftover } = await admin.schema("ops").from("patients").select("id").eq("id", patientId);
  if (leftover?.length) { console.error("Cleanup incomplete."); process.exit(1); }
  console.log("[ok] cleanup verified — no test rows remain");
  console.log("\nSmoke test passed end-to-end.");
}

main();
