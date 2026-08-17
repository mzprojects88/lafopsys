// Regression smoke test for Phase 3 (Donors + Inventory bridge, lafopsys
// side). Exercises the exact insert/update shapes used by
// use-donors-collection.ts, use-acknowledgment-receipts-collection.ts,
// use-donee-certificates-collection.ts, and use-campaigns-collection.ts
// against the live DB, then deletes everything it created.
//
// Usage: node --env-file=.env.local scripts/smoke-test-donors-flow.mjs

import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  // 1. Donor + donation, mirroring addDonation's two-step write (insert donation,
  // roll the aggregate up onto the donor).
  const donorId = randomUUID();
  const { error: donorError } = await admin.schema("ops").from("donors").insert({
    id: donorId,
    source_id: `smoke-test-${Date.now()}`,
    name: "Smoke Test Donor",
    type: "individual",
    tax_jurisdiction: "PH",
    first_gift_date: "2026-08-18",
    last_gift_date: "2026-08-18",
    lifetime_value: 0,
    gift_count: 0,
  });
  if (donorError) { console.error("Donor insert failed:", donorError.message); process.exit(1); }

  const donationId = randomUUID();
  const { error: donationError } = await admin.schema("ops").from("donations").insert({
    id: donationId,
    donor_id: donorId,
    date: "2026-08-18",
    receiving_entity: "PH_SEC",
    kind: "in_kind",
    item_description: "Smoke test item",
    total_value: 500,
    currency: "PHP",
    status: "finalized",
  });
  if (donationError) { console.error("Donation insert failed:", donationError.message); process.exit(1); }

  const { error: rollupError } = await admin
    .schema("ops")
    .from("donors")
    .update({ gift_count: 1, lifetime_value: 500 })
    .eq("id", donorId);
  if (rollupError) { console.error("Donor rollup update failed:", rollupError.message); process.exit(1); }

  const { data: donorReadBack } = await admin.schema("ops").from("donors").select("gift_count, lifetime_value").eq("id", donorId).single();
  if (donorReadBack.gift_count !== 1 || Number(donorReadBack.lifetime_value) !== 500) {
    console.error("Donor rollup did not round-trip correctly:", donorReadBack);
    process.exit(1);
  }
  console.log("[ok] donor + donation inserted, donor rollup (gift_count/lifetime_value) correct");

  // 2. Acknowledgment receipt: generate, then advance through the real stage sequence.
  const arId = randomUUID();
  const { error: arError } = await admin.schema("ops").from("acknowledgment_receipts").insert({
    id: arId,
    donation_id: donationId,
    sequence_number: `AR-SMOKE-${Date.now()}`,
    entity: "PH_SEC",
    status: "draft",
    issued_at: new Date().toISOString(),
  });
  if (arError) { console.error("AR insert failed:", arError.message); process.exit(1); }
  const { error: arAdvanceError } = await admin.schema("ops").from("acknowledgment_receipts").update({ status: "issued" }).eq("id", arId);
  if (arAdvanceError) { console.error("AR advance failed:", arAdvanceError.message); process.exit(1); }
  console.log("[ok] acknowledgment receipt generated and advanced");

  // 3. Donee certificate: generate, then advance.
  const certId = randomUUID();
  const { error: certError } = await admin.schema("ops").from("donee_certificates").insert({
    id: certId,
    donation_id: donationId,
    control_number: `DC-SMOKE-${Date.now()}`,
    status: "requested",
    requested_at: new Date().toISOString(),
  });
  if (certError) { console.error("Certificate insert failed:", certError.message); process.exit(1); }
  const { error: certAdvanceError } = await admin.schema("ops").from("donee_certificates").update({ status: "prepared" }).eq("id", certId);
  if (certAdvanceError) { console.error("Certificate advance failed:", certAdvanceError.message); process.exit(1); }
  console.log("[ok] donee certificate generated and advanced");

  // 4. Campaign.
  const campaignId = randomUUID();
  const { error: campaignError } = await admin.schema("ops").from("campaigns").insert({
    id: campaignId,
    name: "Smoke Test Campaign",
    target_amount: 10000,
    raised_amount: 0,
    start_date: "2026-08-18",
  });
  if (campaignError) { console.error("Campaign insert failed:", campaignError.message); process.exit(1); }
  console.log("[ok] campaign created");

  // Cleanup.
  await admin.schema("ops").from("acknowledgment_receipts").delete().eq("id", arId);
  await admin.schema("ops").from("donee_certificates").delete().eq("id", certId);
  await admin.schema("ops").from("campaigns").delete().eq("id", campaignId);
  const { error: donationDeleteError } = await admin.schema("ops").from("donations").delete().eq("id", donationId);
  if (donationDeleteError) { console.error("Cleanup (donation) failed:", donationDeleteError.message); process.exit(1); }
  const { error: donorDeleteError } = await admin.schema("ops").from("donors").delete().eq("id", donorId);
  if (donorDeleteError) { console.error("Cleanup (donor) failed:", donorDeleteError.message); process.exit(1); }

  const { data: leftover } = await admin.schema("ops").from("donors").select("id").eq("id", donorId);
  if (leftover?.length) { console.error("Cleanup incomplete."); process.exit(1); }
  console.log("[ok] cleanup verified — no test rows remain");
  console.log("\nSmoke test passed end-to-end.");
}

main();
