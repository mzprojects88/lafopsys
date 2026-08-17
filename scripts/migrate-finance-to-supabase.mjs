// One-time migration: seeds ops.programs (the 6-item real program taxonomy,
// same curated-reference-data pattern as Phase 0's provinces/diagnoses) and
// moves the 816 real cash-ledger entries (already cleaned by
// clean-finance-data.py, synced into lib/mock-data/real/cash-entries.json by
// sync-real-data.mjs) into ops.cash_entries.
//
// ops.accounts and ops.budget_lines are NOT touched here -- both are 100%
// rng-fabricated in the mock layer (confirmed by reading the generator), so
// there's nothing real to migrate; both tables start empty.
//
// Idempotent by source_id (the original cash-real-N id) -- learned from the
// donations migration that a composite content key can't be trusted, so this
// one uses a stable id from the start. duplicate_of_id is resolved through an
// oldId -> newId map, same pattern as carer/patient linking.
//
// Usage: node --env-file=.env.local scripts/migrate-finance-to-supabase.mjs

import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import realCashEntries from "../lib/mock-data/real/cash-entries.json" with { type: "json" };

const PROGRAMS = [
  { id: "prog-housing", name: "Housing", description: "Bed nights, accommodation, utilities at LAF House" },
  { id: "prog-meals", name: "Meals", description: "Breakfast, lunch, dinner for resident families" },
  { id: "prog-carecart", name: "Care Cart", description: "Snack and comfort rounds at NCH" },
  { id: "prog-transport", name: "Transportation", description: "Hospital trips, errands, fuel and vehicle upkeep" },
  { id: "prog-activities", name: "Activities", description: "Activity Center sessions at NCH" },
  { id: "prog-spiritual", name: "Spiritual Care", description: "Chaplaincy, counseling, Farewell with Dignity" },
];

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

// 24 of 816 real rows have no usable date (23 "Missing date", 1 unparseable
// raw value like "210/2026") -- all already flagged needsReview with a
// review_reason explaining why. Passing the raw garbage string to a `date`
// column would fail the insert; passing null preserves the real record
// without fabricating a date. See migration 0012.
function toDateOrNull(v) {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

async function migratePrograms() {
  const { data: existing, error } = await admin.schema("ops").from("programs").select("id");
  if (error) { console.error("Failed to check existing programs:", error.message); process.exit(1); }
  const existingIds = new Set(existing.map((p) => p.id));
  const rows = PROGRAMS.filter((p) => !existingIds.has(p.id));
  if (rows.length > 0) {
    const { error: insertError } = await admin.schema("ops").from("programs").insert(rows);
    if (insertError) { console.error("Programs insert failed:", insertError.message); process.exit(1); }
  }
  console.log(`programs: inserted ${rows.length}, skipped ${PROGRAMS.length - rows.length} already present.`);
}

async function migrateCashEntries() {
  const { data: existing, error } = await admin.schema("ops").from("cash_entries").select("id, source_id, duplicate_of_id");
  if (error) { console.error("Failed to check existing cash_entries:", error.message); process.exit(1); }
  const sourceIdToId = new Map(existing.map((e) => [e.source_id, e.id]));
  const sourceIdToExistingDupLink = new Map(existing.map((e) => [e.source_id, e.duplicate_of_id]));

  const oldIdToNewId = new Map();
  const newRows = [];
  let skipped = 0;

  for (const e of realCashEntries) {
    const existingId = sourceIdToId.get(e.id);
    if (existingId) {
      oldIdToNewId.set(e.id, existingId);
      skipped++;
      continue;
    }
    const newId = randomUUID();
    oldIdToNewId.set(e.id, newId);
    newRows.push({ __sourceRow: e, id: newId });
  }

  const insertRows = newRows.map(({ __sourceRow: e, id }) => ({
    id,
    source_id: e.id,
    date: toDateOrNull(e.date),
    direction: e.direction,
    source: e.source,
    entity: e.entity,
    currency: e.currency,
    amount: e.amount,
    program_id: nullIfEmpty(e.programId),
    description: e.description,
    approval_status: e.approvalStatus,
    donor_name: nullIfEmpty(e.donorName),
    source_sheet: nullIfEmpty(e.sourceSheet),
    needs_review: e.needsReview ?? false,
    review_reason: nullIfEmpty(e.reviewReason),
  }));

  for (let i = 0; i < insertRows.length; i += CHUNK) {
    const { error: insertError } = await admin.schema("ops").from("cash_entries").insert(insertRows.slice(i, i + CHUNK));
    if (insertError) { console.error(`cash_entries insert failed at chunk starting ${i}:`, insertError.message); process.exit(1); }
  }
  console.log(`cash_entries: inserted ${insertRows.length}, skipped ${skipped} already present.`);

  // Reconciled over ALL source rows every run, not just this run's new
  // inserts -- a prior partial failure can leave some already-present rows
  // with duplicate_of_id never resolved (their target didn't have a new id
  // yet when they were first inserted), so this has to be self-healing
  // rather than assuming "already present" means "already fully linked."
  let linked = 0;
  for (const e of realCashEntries) {
    if (!e.duplicateOfId) continue;
    const rowId = oldIdToNewId.get(e.id);
    const targetId = oldIdToNewId.get(e.duplicateOfId);
    if (!targetId || sourceIdToExistingDupLink.get(e.id) === targetId) continue;
    const { error: dupError } = await admin.schema("ops").from("cash_entries").update({ duplicate_of_id: targetId }).eq("id", rowId);
    if (dupError) { console.error(`duplicate_of_id update failed for ${rowId}:`, dupError.message); process.exit(1); }
    linked++;
  }
  console.log(`cash_entries: linked ${linked} duplicate_of_id references this run.`);
}

async function main() {
  await migratePrograms();
  await migrateCashEntries();
}

main();
