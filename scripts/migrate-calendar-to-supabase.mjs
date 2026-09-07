// One-time import of the master calendar into ops.calendar_events.
//
// Source: lib/mock-data/real/calendar-events.json, produced by
// scripts/clean-calendar-data.py from the workbook and copied in by
// scripts/sync-real-data.mjs. Run the cleaner first if the workbook changed.
//
// Idempotent on the table's natural key (date, title, time): re-running after
// the sheet is updated inserts only the new rows and reports the rest as
// skipped. Nothing is ever updated or deleted here -- once an event is in the
// app, the app is where it is edited.
//
// Usage: node --env-file=.env.local scripts/migrate-calendar-to-supabase.mjs

import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import events from "../lib/mock-data/real/calendar-events.json" with { type: "json" };

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local.");
  process.exit(1);
}

const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
const CHUNK = 100;

const key = (date, title, time) => `${date}|${title}|${time ?? ""}`;

const { data: existing, error } = await admin.schema("ops").from("calendar_events").select("date, title, time");
if (error) {
  console.error("Failed to read existing calendar_events:", error.message);
  process.exit(1);
}
const existingKeys = new Set(existing.map((r) => key(r.date, r.title, r.time)));

const rows = events
  .filter((e) => !existingKeys.has(key(e.date, e.title, e.time ?? null)))
  .map((e) => ({
    id: randomUUID(),
    date: e.date,
    time: e.time ?? null,
    title: e.title,
    venue: e.venue ?? null,
    officer_on_duty: e.officerOnDuty ?? null,
    staff_needed: e.staffNeeded ?? null,
    booked_by: e.bookedBy ?? null,
    contact_info: e.contactInfo ?? null,
    remarks: e.remarks ?? null,
    is_holiday: e.isHoliday === true,
  }));

for (let i = 0; i < rows.length; i += CHUNK) {
  const { error: insertError } = await admin.schema("ops").from("calendar_events").insert(rows.slice(i, i + CHUNK));
  if (insertError) {
    console.error(`calendar_events insert failed at row ${i}:`, insertError.message);
    process.exit(1);
  }
}

console.log(`calendar_events: inserted ${rows.length}, skipped ${events.length - rows.length} already present.`);
