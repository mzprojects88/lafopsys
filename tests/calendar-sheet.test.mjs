// Unit tests for lib/utils/calendar-sheet.ts -- reading the master calendar's
// Google Sheet and deciding what to write. Pure, so the whole sync is
// exercised here without a network or a database.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildKey, normalizeTime, normalizeTitle, parseSheetCsv, reconcile, sheetCsvUrl } from "../lib/utils/calendar-sheet.ts";

describe("normalizeTime", () => {
  it("turns every clock form into HH:MM", () => {
    const cases = [
      ["3:00 PM", "15:00"],
      ["3:00:00 PM", "15:00"],
      ["10:30 AM", "10:30"],
      ["9 AM", "09:00"],
      ["9 a.m.", "09:00"],
      ["12:00 NN", "12:00"],
      ["12:00 MN", "00:00"],
      ["12:00 AM", "00:00"],
      ["12:00 PM", "12:00"],
      ["15:00", "15:00"],
      ["9:00", "09:00"],
      ["  3:00  pm ", "15:00"],
    ];
    for (const [raw, expected] of cases) assert.equal(normalizeTime(raw), expected, raw);
  });

  it("keeps everything else as lower-cased text", () => {
    assert.equal(normalizeTime("3:00 PM - 5:00 PM"), "3:00 pm - 5:00 pm");
    assert.equal(normalizeTime("1-5 PM"), "1-5 pm");
    assert.equal(normalizeTime("1-5pm"), "1-5pm");
    assert.equal(normalizeTime("All day"), "all day");
    assert.equal(normalizeTime("TBA"), "tba");
    assert.equal(normalizeTime("evening"), "evening");
    assert.equal(normalizeTime("25:00"), "25:00");
  });

  it("treats blank and the junk 'SAY NO' as no time", () => {
    assert.equal(normalizeTime(""), "");
    assert.equal(normalizeTime(null), "");
    assert.equal(normalizeTime(undefined), "");
    assert.equal(normalizeTime("SAY NO"), "");
  });
});

describe("keys", () => {
  it("ignores case and spacing in the title", () => {
    assert.equal(normalizeTitle("  Cath   meeting  "), "cath meeting");
    assert.equal(buildKey("2026-09-08", "Cath Meeting", "14:00"), buildKey("2026-09-08", "cath  meeting", "14:00"));
    assert.equal(buildKey("2026-09-08", "A", ""), "2026-09-08|a|");
  });

  it("uses the export endpoint, not gviz", () => {
    assert.match(sheetCsvUrl(), /\/export\?format=csv&gid=590670193$/);
  });
});

const HEADER = " ,Date,Time,Event ,Venue,Officer on Duty,Staff Needed,Booked By:,Contact Name and Number,Remarks";

describe("parseSheetCsv", () => {
  it("reads the sheet's own layout, carrying the date down", () => {
    const csv = [
      HEADER,
      ",,,,,,,,,",
      "Wednesday,4/1/2026,12:00 NN,Gerry's Grill Care Cart,NCH,Butch,,,,",
      ",,3:00 PM,\"Lao, Ching, Yulo Family\",LAF,Butch,,,,",
      "Thursday,4/2/2026,,Maundy Thursday,,Butch,,,,",
      "Friday,4/3/2026,,,,,,,,",
      "Monday,8/31/2026,SAY NO,Ninoy Aquino Day,,NINOY AQUINO DAY,,,,",
    ].join("\n");
    const { events, forwardFilled, duplicates, problems } = parseSheetCsv(csv);
    assert.deepEqual(problems, []);
    assert.equal(events.length, 4);
    assert.equal(forwardFilled, 1);
    assert.equal(duplicates, 0);

    assert.equal(events[0].date, "2026-04-01");
    assert.equal(events[0].time, "12:00 NN");
    assert.equal(events[0].timeKey, "12:00");
    assert.equal(events[0].key, "2026-04-01|gerry's grill care cart|12:00");

    assert.equal(events[1].date, "2026-04-01", "second row takes the date from above");
    assert.equal(events[1].title, "Lao, Ching, Yulo Family");
    assert.equal(events[1].timeKey, "15:00");

    assert.equal(events[2].isHoliday, true, "Maundy Thursday by title");
    assert.equal(events[3].isHoliday, true, "holiday name in the officer column");
    assert.equal(events[3].officerOnDuty, null);
    assert.equal(events[3].time, null, "'SAY NO' in the time column is not a time");
  });

  it("finds columns by name, whatever their order", () => {
    const csv = ["Remarks,Event,Venue,Date,Time", "note,Staff Meeting,LAF,4/28/2026,1:00 PM"].join("\n");
    const { events, problems } = parseSheetCsv(csv);
    assert.deepEqual(problems, []);
    assert.equal(events[0].title, "Staff Meeting");
    assert.equal(events[0].remarks, "note");
    assert.equal(events[0].timeKey, "13:00");
  });

  it("counts a repeated row once", () => {
    const csv = [HEADER, ",4/1/2026,3:00 PM,Same,LAF,,,,,", ",,3:00 pm,same,LAF,,,,,"].join("\n");
    const { events, duplicates } = parseSheetCsv(csv);
    assert.equal(events.length, 1);
    assert.equal(duplicates, 1);
  });

  it("refuses a sheet whose header has moved on", () => {
    const { events, problems } = parseSheetCsv("Day,When,What\nMon,4/1/2026,x");
    assert.equal(events.length, 0);
    assert.match(problems[0], /no date or title column|no title column|no date/i);
  });

  it("keeps a row under the previous date when its own date is unreadable", () => {
    const csv = [HEADER, ",4/1/2026,,First,,,,,,", ",April 2,,Second,,,,,,"].join("\n");
    const { events, problems } = parseSheetCsv(csv);
    assert.equal(events.length, 2);
    assert.equal(events[1].date, "2026-04-01");
    assert.equal(problems.length, 1);
  });
});

describe("reconcile", () => {
  const today = "2026-09-08";
  const now = "2026-09-08T04:00:00.000Z";
  let n = 0;
  const sheetEvent = (date, title, time, extra = {}) => {
    const { events } = parseSheetCsv([HEADER, `,${date.slice(5, 7)}/${date.slice(8)}/${date.slice(0, 4)},${time ?? ""},${title},${extra.venue ?? ""},${extra.officer ?? ""},,,,${extra.remarks ?? ""}`].join("\n"));
    return events[0];
  };
  const dbRow = (date, title, time, extra = {}) => ({
    id: `r${++n}`,
    date,
    time,
    timeKey: normalizeTime(time),
    title,
    venue: extra.venue ?? null,
    officerOnDuty: extra.officer ?? null,
    staffNeeded: null,
    bookedBy: null,
    contactInfo: null,
    remarks: extra.remarks ?? null,
    isHoliday: extra.isHoliday ?? false,
    sheetKey: extra.sheetKey ?? null,
    sheetRemovedAt: extra.removedAt ?? null,
  });
  const run = (sheet, dbSheet, appKeys = []) => reconcile({ sheet, dbSheet, appKeys: new Set(appKeys), today, now });

  it("inserts what the sheet has and the app does not", () => {
    const plan = run([sheetEvent("2026-09-10", "New visit", "10:00 AM")], []);
    assert.equal(plan.inserts.length, 1);
    assert.equal(plan.inserts[0].source, "sheet");
    assert.equal(plan.inserts[0].time, "10:00 AM");
    assert.equal(plan.inserts[0].time_key, "10:00");
    assert.equal(plan.counts.inserted, 1);
  });

  it("matches the workbook's 15:00 to the sheet's 3:00 PM and adopts the sheet's text", () => {
    const row = dbRow("2026-09-10", "Visit", "15:00");
    const plan = run([sheetEvent("2026-09-10", "Visit", "3:00 PM")], [row]);
    assert.equal(plan.inserts.length, 0);
    assert.equal(plan.removes.length, 0);
    assert.equal(plan.updates.length, 1);
    assert.equal(plan.updates[0].patch.time, "3:00 PM");
    assert.equal(plan.updates[0].patch.sheet_key, "2026-09-10|visit|15:00");
    assert.equal(plan.updates[0].patch.time_key, undefined, "same time key already");
    assert.equal(plan.counts.updated, 1);
  });

  it("updates a changed venue and nothing else", () => {
    const row = dbRow("2026-09-10", "Visit", "3:00 PM", { venue: "NCH", sheetKey: "2026-09-10|visit|15:00" });
    const plan = run([sheetEvent("2026-09-10", "Visit", "3:00 PM", { venue: "LAF" })], [row]);
    assert.equal(plan.updates.length, 1);
    assert.deepEqual(plan.updates[0].patch, { venue: "LAF", sheet_synced_at: now, updated_by: null });
  });

  it("writes nothing for a row that has not changed", () => {
    const row = dbRow("2026-09-10", "Visit", "3:00 PM", { venue: "LAF", sheetKey: "2026-09-10|visit|15:00" });
    const plan = run([sheetEvent("2026-09-10", "Visit", "3:00 PM", { venue: "LAF" })], [row]);
    assert.equal(plan.updates.length, 0);
    assert.equal(plan.counts.updated, 0);
  });

  it("reads a retyped time as a change, not a removal and an addition", () => {
    const row = dbRow("2026-09-10", "Visit", "3:00 PM", { sheetKey: "2026-09-10|visit|15:00" });
    const plan = run([sheetEvent("2026-09-10", "Visit", "4:00 PM")], [row]);
    assert.equal(plan.inserts.length, 0);
    assert.equal(plan.removes.length, 0);
    assert.equal(plan.updates[0].patch.time, "4:00 PM");
    assert.equal(plan.updates[0].patch.time_key, "16:00");
    assert.equal(plan.updates[0].patch.sheet_key, "2026-09-10|visit|16:00");
  });

  it("does not guess between two same-day candidates", () => {
    const rows = [dbRow("2026-09-10", "Visit", "3:00 PM"), dbRow("2026-09-10", "Visit", "5:00 PM")];
    const plan = run([sheetEvent("2026-09-10", "Visit", "4:00 PM")], rows);
    assert.equal(plan.inserts.length, 1);
    assert.equal(plan.removes.length, 2);
  });

  it("hides an upcoming event that left the sheet, and leaves a past one alone", () => {
    const upcoming = dbRow("2026-09-10", "Gone", "3:00 PM");
    const past = dbRow("2026-04-01", "Old", "3:00 PM");
    const todayRow = dbRow(today, "Today", "3:00 PM");
    const plan = run([], [upcoming, past, todayRow]);
    assert.deepEqual(plan.removes.sort(), [upcoming.id, todayRow.id].sort());
    assert.equal(plan.counts.removed, 2);
  });

  it("does not hide again what is already hidden", () => {
    const row = dbRow("2026-09-10", "Gone", "3:00 PM", { removedAt: "2026-09-07T00:00:00Z" });
    assert.equal(run([], [row]).removes.length, 0);
  });

  it("restores a hidden event when it reappears", () => {
    const row = dbRow("2026-09-10", "Back", "3:00 PM", { sheetKey: "2026-09-10|back|15:00", removedAt: "2026-09-07T00:00:00Z" });
    const plan = run([sheetEvent("2026-09-10", "Back", "3:00 PM")], [row]);
    assert.equal(plan.updates[0].patch.sheet_removed_at, null);
    assert.equal(plan.counts.restored, 1);
  });

  it("never touches an app-created event with the same key", () => {
    const plan = run([sheetEvent("2026-09-10", "Ours", "3:00 PM")], [], ["2026-09-10|ours|15:00"]);
    assert.equal(plan.inserts.length, 0);
    assert.equal(plan.updates.length, 0);
    assert.equal(plan.counts.collisions, 1);
  });

  it("matches a row imported before keys existed", () => {
    const row = dbRow("2026-09-10", "Visit", "15:00"); // sheetKey null, timeKey coalesced by the caller
    const plan = run([sheetEvent("2026-09-10", "Visit", "3:00 PM")], [row]);
    assert.equal(plan.updates.length, 1);
    assert.equal(plan.updates[0].patch.sheet_key, "2026-09-10|visit|15:00");
  });
});
