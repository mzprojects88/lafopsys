// One-time backfill of ops.bank_transactions from the workbook's Bank
// Statement tab (January to July 2026), so the CEO's summary has history on
// day one. From August on, statements arrive through /finance/bank-import.
//
// Source: lib/mock-data/real/bank-transactions.json, produced by
// scripts/clean-finance-data.py (which now keeps the running balance and the
// memo column) and copied in by scripts/sync-real-data.mjs.
//
// Idempotent on the table's natural key. Re-running inserts nothing new and
// still records an import batch with inserted_count = 0, so the history
// explains itself. Nothing is updated or deleted -- the money tables are
// append-only, and this script is no exception.
//
// Usage: node --env-file=.env.local scripts/backfill-bank-transactions.mjs

import { createClient } from "@supabase/supabase-js";
import rows from "../lib/mock-data/real/bank-transactions.json" with { type: "json" };

const ROOT = new URL("..", import.meta.url).href;
const { categorize, checkContinuity, naturalKey, summarizeBatch } = await import(`${ROOT}lib/utils/bank-statement.ts`);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local.");
  process.exit(1);
}

const ACCOUNT_ID = "00000000-0000-4000-8000-00000000bd01"; // seeded by 0033
/** The balance before the first line of the first statement, implied by that line. */
const OPENING_BALANCE = 327880.08;
const CHUNK = 100;

const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

const clean = rows.filter((r) => r.postingDate && r.runningBalance !== null);
if (clean.length !== rows.length) {
  console.warn(`Skipping ${rows.length - clean.length} row(s) with no date or balance.`);
}

const summary = summarizeBatch(clean);
const warnings = checkContinuity(clean, OPENING_BALANCE);

const { data: existing, error: existingError } = await admin
  .schema("ops")
  .from("bank_transactions")
  .select("posting_date, description, debit, credit, running_balance")
  .eq("account_id", ACCOUNT_ID)
  .gte("posting_date", summary.coversFrom)
  .lte("posting_date", summary.coversTo);
if (existingError) {
  console.error("Failed to read existing bank_transactions:", existingError.message);
  process.exit(1);
}
const existingKeys = new Set(
  existing.map((r) =>
    naturalKey({ postingDate: r.posting_date, description: r.description, debit: Number(r.debit), credit: Number(r.credit), runningBalance: Number(r.running_balance) }, ACCOUNT_ID)
  )
);

const fresh = clean.filter((r) => !existingKeys.has(naturalKey(r, ACCOUNT_ID)));

const { data: batch, error: batchError } = await admin
  .schema("ops")
  .from("bank_statement_imports")
  .insert({
    account_id: ACCOUNT_ID,
    file_name: "2026 LAF Donation Tracker.xlsx › Bank Statement",
    source: "workbook_backfill",
    covers_from: summary.coversFrom,
    covers_to: summary.coversTo,
    opening_balance: OPENING_BALANCE,
    closing_balance: summary.closing,
    row_count: clean.length,
    inserted_count: fresh.length,
    skipped_count: clean.length - fresh.length,
    continuity_warnings: warnings.length,
    imported_by: null,
  })
  .select("id")
  .single();
if (batchError) {
  console.error("Failed to record the import batch:", batchError.message);
  process.exit(1);
}

const payload = fresh.map((r) => ({
  account_id: ACCOUNT_ID,
  import_id: batch.id,
  row_seq: r.rowSeq,
  posting_date: r.postingDate,
  branch: r.branch,
  description: r.description,
  debit: r.debit,
  credit: r.credit,
  running_balance: r.runningBalance,
  check_number: r.checkNumber,
  memo: r.memo,
  category: categorize(r.description),
  needs_review: r.needsReview,
  review_reason: r.reviewReason,
}));

for (let i = 0; i < payload.length; i += CHUNK) {
  const { error } = await admin.schema("ops").from("bank_transactions").insert(payload.slice(i, i + CHUNK));
  if (error) {
    console.error(`bank_transactions insert failed at row ${i}:`, error.message);
    process.exit(1);
  }
}

console.log(`bank_transactions: inserted ${fresh.length}, skipped ${clean.length - fresh.length} already present.`);
console.log(`Covers ${summary.coversFrom} to ${summary.coversTo}; closing balance ${summary.closing.toFixed(2)}.`);
console.log(`Continuity warnings: ${warnings.length}`);
for (const w of warnings) console.log(`  ${w.message}`);
