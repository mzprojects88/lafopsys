// One-time migration: moves the 242 real donors + 785 real donations
// (already cleaned by clean-real-data.py, synced into lib/mock-data/real/*.json
// by sync-real-data.mjs) into ops.donors/ops.donations.
//
// ops.donors.id / ops.donations.id are fresh UUIDs, not the mock
// "donor-real-N"/"don-real-N" scheme -- donations link to donors through a
// donorId -> new-UUID map built the same way migrate-patients-to-supabase.mjs
// mapped carers to patients.
//
// Real donations have no campaignId/uomId/createdInventoryLotId (confirmed:
// 0 of 785 rows have any of the three) -- left null, not fabricated.
//
// Idempotent by source_id (the original donor-real-N/don-real-N id), NOT a
// composite content key -- 3 real donor/date/item/value combinations occur
// twice in the source (genuinely duplicate donations, not data errors), so a
// content-based key can't tell "second of a legit pair" from "already
// inserted" and double-inserts on re-run. source_id is a stable per-row key
// the same way patient_number is for ops.patients.
//
// Usage: node --env-file=.env.local scripts/migrate-donors-to-supabase.mjs

import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import realDonors from "../lib/mock-data/real/donors.json" with { type: "json" };
import realDonations from "../lib/mock-data/real/donations.json" with { type: "json" };

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local.");
  process.exit(1);
}

const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
const CHUNK = 100;

function nullIfEmpty(v) {
  return v === undefined || v === null || v === "" ? null : v;
}

async function main() {
  const { data: existingDonors, error: existingDonorsError } = await admin
    .schema("ops")
    .from("donors")
    .select("id, source_id");
  if (existingDonorsError) { console.error("Failed to check existing donors:", existingDonorsError.message); process.exit(1); }
  const sourceIdToId = new Map(existingDonors.map((d) => [d.source_id, d.id]));

  const oldDonorIdToNewId = new Map();
  const donorRows = [];
  let skippedDonors = 0;

  for (const d of realDonors) {
    const existingId = sourceIdToId.get(d.id);
    if (existingId) {
      oldDonorIdToNewId.set(d.id, existingId);
      skippedDonors++;
      continue;
    }
    const newId = randomUUID();
    oldDonorIdToNewId.set(d.id, newId);
    donorRows.push({
      id: newId,
      source_id: d.id,
      name: d.name,
      type: d.type,
      email: nullIfEmpty(d.email),
      phone: nullIfEmpty(d.phone),
      tax_jurisdiction: d.taxJurisdiction,
      tin: nullIfEmpty(d.tin),
      first_gift_date: nullIfEmpty(d.firstGiftDate),
      last_gift_date: nullIfEmpty(d.lastGiftDate),
      lifetime_value: d.lifetimeValue ?? 0,
      gift_count: d.giftCount ?? 0,
    });
  }

  for (let i = 0; i < donorRows.length; i += CHUNK) {
    const { error } = await admin.schema("ops").from("donors").insert(donorRows.slice(i, i + CHUNK));
    if (error) { console.error(`Donor insert failed at chunk starting ${i}:`, error.message); process.exit(1); }
  }
  console.log(`donors: inserted ${donorRows.length}, skipped ${skippedDonors} already present.`);

  const { data: existingDonations, error: existingDonationsError } = await admin
    .schema("ops")
    .from("donations")
    .select("source_id");
  if (existingDonationsError) { console.error("Failed to check existing donations:", existingDonationsError.message); process.exit(1); }
  const existingDonationSourceIds = new Set(existingDonations.map((d) => d.source_id));

  const donationRows = [];
  let skippedDonations = 0;

  for (const d of realDonations) {
    if (existingDonationSourceIds.has(d.id)) {
      skippedDonations++;
      continue;
    }
    const newDonorId = oldDonorIdToNewId.get(d.donorId);
    if (!newDonorId) {
      console.error(`Donation ${d.id} references unknown donorId ${d.donorId} -- aborting rather than dropping it silently.`);
      process.exit(1);
    }
    donationRows.push({
      id: randomUUID(),
      source_id: d.id,
      donor_id: newDonorId,
      date: d.date,
      receiving_entity: d.receivingEntity,
      kind: d.kind,
      item_description: nullIfEmpty(d.itemDescription),
      item_type: nullIfEmpty(d.itemType),
      quantity: d.quantity ?? null,
      uom_id: nullIfEmpty(d.uomId),
      unit_value: d.unitValue ?? null,
      total_value: d.totalValue,
      currency: d.currency,
      campaign_id: null, // 0 of 785 real donations have a campaignId
      created_inventory_lot_id: nullIfEmpty(d.createdInventoryLotId),
      status: "finalized", // already-known historical records, not pending review
    });
  }

  for (let i = 0; i < donationRows.length; i += CHUNK) {
    const { error } = await admin.schema("ops").from("donations").insert(donationRows.slice(i, i + CHUNK));
    if (error) { console.error(`Donation insert failed at chunk starting ${i}:`, error.message); process.exit(1); }
  }
  console.log(`donations: inserted ${donationRows.length}, skipped ${skippedDonations} already present.`);
}

main();
