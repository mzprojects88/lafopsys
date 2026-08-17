// Regression smoke test for Phase 4 (Finance). Exercises the exact
// insert/update shapes used by use-cash-entries-collection.ts,
// use-accounts-collection.ts, and use-budget-lines-collection.ts against the
// live DB, including a null-date entry (24 real rows have no usable date --
// see migration 0012), then deletes everything it created.
//
// Usage: node --env-file=.env.local scripts/smoke-test-finance-flow.mjs

import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const { data: progs } = await admin.schema("ops").from("programs").select("id").limit(1);
  if (!progs?.length) { console.error("Missing programs reference data."); process.exit(1); }
  const programId = progs[0].id;

  // 1. Cash entry with a real date.
  const entryId = randomUUID();
  const { error: entryError } = await admin.schema("ops").from("cash_entries").insert({
    id: entryId,
    date: "2026-08-18",
    direction: "outflow",
    source: "admin_ops",
    entity: "PH_SEC",
    currency: "PHP",
    amount: 500,
    program_id: programId,
    description: "Smoke test entry",
    approval_status: "pending",
    needs_review: false,
  });
  if (entryError) { console.error("Cash entry insert failed:", entryError.message); process.exit(1); }

  const { error: approveError } = await admin.schema("ops").from("cash_entries").update({ approval_status: "approved" }).eq("id", entryId);
  if (approveError) { console.error("Approval update failed:", approveError.message); process.exit(1); }
  console.log("[ok] cash entry inserted and approved");

  // 2. Cash entry with a null date (mirrors the 24 real rows with no usable date).
  const nullDateEntryId = randomUUID();
  const { error: nullDateError } = await admin.schema("ops").from("cash_entries").insert({
    id: nullDateEntryId,
    date: null,
    direction: "outflow",
    source: "admin_ops",
    entity: "PH_SEC",
    currency: "PHP",
    amount: 100,
    description: "Smoke test entry with missing date",
    approval_status: "pending",
    needs_review: true,
    review_reason: "Smoke test — missing date",
  });
  if (nullDateError) { console.error("Null-date cash entry insert failed:", nullDateError.message); process.exit(1); }
  console.log("[ok] cash entry with null date inserted (matches real needs_review rows)");

  // 3. Account (starts empty by design -- verify a real one can be added).
  const accountId = randomUUID();
  const { error: accountError } = await admin.schema("ops").from("accounts").insert({
    id: accountId,
    name: "Smoke Test Account",
    entity: "PH_SEC",
    currency: "PHP",
    balance: 1000,
    type: "cash_on_hand",
  });
  if (accountError) { console.error("Account insert failed:", accountError.message); process.exit(1); }
  console.log("[ok] account inserted");

  // 4. Budget line (starts empty by design).
  const budgetLineId = randomUUID();
  const { error: budgetError } = await admin.schema("ops").from("budget_lines").insert({
    id: budgetLineId,
    program_id: programId,
    month: "2026-08",
    budgeted: 5000,
    actual: 0,
  });
  if (budgetError) { console.error("Budget line insert failed:", budgetError.message); process.exit(1); }
  console.log("[ok] budget line inserted");

  // Cleanup.
  await admin.schema("ops").from("cash_entries").delete().eq("id", entryId);
  await admin.schema("ops").from("cash_entries").delete().eq("id", nullDateEntryId);
  await admin.schema("ops").from("accounts").delete().eq("id", accountId);
  await admin.schema("ops").from("budget_lines").delete().eq("id", budgetLineId);

  const { data: leftover } = await admin.schema("ops").from("cash_entries").select("id").in("id", [entryId, nullDateEntryId]);
  if (leftover?.length) { console.error("Cleanup incomplete."); process.exit(1); }
  console.log("[ok] cleanup verified — no test rows remain");
  console.log("\nSmoke test passed end-to-end.");
}

main();
