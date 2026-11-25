// Read only: is ArkOS's calendar the same as the Master Calendar sheet? For the days before the switch to
// "ArkOS is the master calendar" (owner, 25 Nov 2026), and to see what the copy sheet will hold.
// Prints counts only: no event titles, no names, no contact details.
//   node --env-file=.env.prod.local scripts/calendar-copy-check.mjs
import pg from "pg";
import { pgUrl } from "./lib/db-url.mjs";
import { buildKey, CALENDAR_SHEET_ID, CALENDAR_SHEET_TABS, copyRows, mergeSheets, normalizeTime, parseSheetCsv, sheetCsvUrl } from "../lib/utils/calendar-sheet.ts";

// Every tab that holds events, as the sync reads them.
const tabs = [];
for (const { gid, program } of CALENDAR_SHEET_TABS) {
  const res = await fetch(sheetCsvUrl(CALENDAR_SHEET_ID, gid));
  if (!res.ok) throw new Error(`The sheet answered ${res.status} for tab ${gid}`);
  tabs.push(parseSheetCsv(await res.text(), program));
}
console.log("events per tab:", tabs.map((t, i) => `${CALENDAR_SHEET_TABS[i].program} ${t.events.length}`).join(" + "));
const sheet = mergeSheets(tabs);
if (sheet.problems.length) console.log("sheet problems:", sheet.problems.length);

const c = new pg.Client({ connectionString: pgUrl(), ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query("begin read only");
const { rows } = await c.query(
  `select to_jsonb(e) e from ops.calendar_events e where sheet_removed_at is null`
);
const { rows: [state] } = await c.query(
  `select (select calendar_sheet_sync_enabled from shared.app_settings where id) sync_on,
          (select to_char(max(finished_at) at time zone 'Asia/Manila', 'DD Mon HH12:MI AM') from ops.calendar_sync_runs where status in ('success', 'unchanged')) last_run`
);
await c.query("rollback");
await c.end();

// to_jsonb: the program columns (0171) are read when the database has them, and missing ones read as empty.
const events = rows.map((r) => r.e);
const app = new Map(events.map((r) => [buildKey(r.date, r.title, r.time_key ?? normalizeTime(r.time)), r]));
const inSheet = new Map(sheet.events.map((e) => [e.key, e]));
const same = (a, b) => (a ?? "") === (b ?? "");
const fields = [
  ["time", (e) => e.time, (r) => r.time],
  ["venue", (e) => e.venue, (r) => r.venue],
  ["off staff", (e) => e.officerOnDuty, (r) => r.officer_on_duty],
  ["staff needed", (e) => e.staffNeeded, (r) => r.staff_needed],
  ["booked by", (e) => e.bookedBy, (r) => r.booked_by],
  ["contact", (e) => e.contactInfo, (r) => r.contact_info],
  ["remarks", (e) => e.remarks, (r) => r.remarks],
  ["program", (e) => e.program, (r) => r.program ?? "general"],
  ["menu", (e) => e.menu, (r) => r.menu],
  ["volunteers", (e) => e.volunteers, (r) => r.volunteers],
];
let both = 0;
const differs = Object.fromEntries(fields.map(([name]) => [name, 0]));
for (const [key, e] of inSheet) {
  const r = app.get(key);
  if (!r) continue;
  both++;
  for (const [name, ofSheet, ofApp] of fields) if (!same(ofSheet(e), ofApp(r))) differs[name]++;
}
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
const onlySheet = [...inSheet.keys()].filter((k) => !app.has(k));
const onlyApp = [...app.keys()].filter((k) => !inSheet.has(k));
const upcoming = (keys) => keys.filter((k) => k.slice(0, 10) >= today).length;
const copy = copyRows(events.filter((r) => (r.program ?? "general") === "general").map((r) => ({ date: r.date, time: r.time, title: r.title, venue: r.venue, officerOnDuty: r.officer_on_duty, staffNeeded: r.staff_needed, bookedBy: r.booked_by, contactInfo: r.contact_info, remarks: r.remarks })));

console.log(`sheet sync is ${state.sync_on ? "ON" : "OFF"}; last good run ${state.last_run ?? "never"}`);
console.log(`events: sheet ${inSheet.size}, ArkOS ${app.size} (added in ArkOS: ${events.filter((r) => r.source === "app").length})`);
console.log(`in both: ${both} | only in the sheet: ${onlySheet.length} (today or later: ${upcoming(onlySheet)}) | only in ArkOS: ${onlyApp.length} (today or later: ${upcoming(onlyApp)})`);
console.log("cells that differ, of the events in both:", JSON.stringify(differs));
console.log(`the copy's yearly lists would hold ${copy.length} rows, ${copy.filter((r) => r[1] < today).length} of them past, from ${copy[0]?.[1]} to ${copy.at(-1)?.[1]}`);
