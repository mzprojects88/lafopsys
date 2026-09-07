// Seeds ops.finance_month_notes with the "Key Monthly Drivers" paragraphs
// from the CEO's summary sheet (lib/mock-data/real/finance-month-notes.json,
// via scripts/clean-finance-month-notes.py and sync-real-data.mjs).
//
// A month that already has a note in the app is left alone -- the sheet was
// the starting point, the app is where notes are written now, and a re-run
// must never overwrite what someone typed. Only months with an empty note
// (or none) are filled.
//
// Usage: node --env-file=.env.local scripts/seed-finance-month-notes.mjs

import { createClient } from "@supabase/supabase-js";
import notes from "../lib/mock-data/real/finance-month-notes.json" with { type: "json" };

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local.");
  process.exit(1);
}
const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

const { data: existing, error } = await admin.schema("ops").from("finance_month_notes").select("month, drivers");
if (error) {
  console.error("Failed to read finance_month_notes:", error.message);
  process.exit(1);
}
const written = new Map(existing.map((r) => [r.month, r.drivers]));

let seeded = 0;
let kept = 0;
for (const note of notes) {
  const current = written.get(note.month);
  if (current && current.trim() !== "") {
    kept += 1;
    continue;
  }
  const { error: upsertError } = await admin
    .schema("ops")
    .from("finance_month_notes")
    .upsert({ month: note.month, drivers: note.drivers, updated_by: null }, { onConflict: "month" });
  if (upsertError) {
    console.error(`Failed to seed ${note.month}:`, upsertError.message);
    process.exit(1);
  }
  seeded += 1;
}
console.log(`finance_month_notes: seeded ${seeded}, kept ${kept} already written in the app.`);
