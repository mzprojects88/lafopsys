// lib/utils/programs-sheet.ts + programs-care-cart.ts (0103): the LAF Programs sheet into the app.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { headcounts, monthTab, patientMeals } from "../lib/utils/programs-sheet.ts";
import { runsFromSheet } from "../lib/utils/programs-care-cart.ts";

// A-M of a month tab: week, day, date, D, CL, patient, carer, BN, M-B, M-L, M-D, L-N, N-L
const header = ["WEEK", "DAY", "DATE", "D", "CL", "PATIENT NAME", "CARER'S NAME", "BN", "M-B", "M-L", "M-D", "L-N", "N-L"];

describe("LAF Programs month tabs", () => {
  it("names the tab's month", () => {
    assert.deepEqual(monthTab("SEPT 2026"), { month: 9, year: 2026 });
    assert.equal(monthTab("Care Cart"), null);
  });
  it("one entry per patient per day; a blank date carries; L-N / N-L and the totals row are not read", () => {
    const rows = [
      header,
      ["W45", "THU", "Oct 1", "C", "1", "Doe, Ann", "Doe, Mom", "2", "2", "2", "2", "9", "9"],
      ["", "", "", "C", "2", "Roe, Ben", "", "2", "1", "0", "2", "", ""],
      ["", "", "", "C", "1", "Doe, Ann", "Doe, Mom", "2", "0", "0", "0", "", ""],
      ["", "", "", "", "", "", "", "", "", "", "", "", ""],
      ["", "", "", "", "", "TOTAL", "", "", "350", "340", "360", "", ""],
    ];
    const m = patientMeals(rows, 2026);
    assert.deepEqual(m.map((r) => [r.date, r.patientName, r.breakfast, r.lunch, r.dinner]), [
      ["2026-10-01", "Doe, Ann", 2, 2, 2],
      ["2026-10-01", "Roe, Ben", 1, 0, 2],
    ]);
    assert.deepEqual(headcounts(m), [
      { date: "2026-10-01", mealType: "breakfast", patients: 2, carers: 1 },
      { date: "2026-10-01", mealType: "lunch", patients: 1, carers: 1 },
      { date: "2026-10-01", mealType: "dinner", patients: 2, carers: 2 },
    ]);
  });
});

describe("LAF Programs Care Cart tab", () => {
  it("groups dish rows into a run by date and time", () => {
    const row = (sheetRow, cells) => ({ sheetRow, cells: [...cells, ...Array(11).fill("")].slice(0, 11) });
    const { runs } = runsFromSheet([
      row(3, ["OCT", "W40", "10/1/2026", "10:00 AM", "Lugaw", "3 KG", "10", "1000", "100", "LAF PANTRY", "2"]),
      row(4, ["", "", "", "", "Boiled Egg", "100 PCS", "8", "800", "", "LAF PANTRY", ""]),
      row(5, ["", "", "10/1/2026", "5:00 PM", "Champorado", "2 KG", "9", "900", "102", "LAF PANTRY", "1"]),
    ]);
    assert.deepEqual(runs.map((r) => [r.date, r.timeSlot, r.servedCount, r.dishes.length]), [
      ["2026-10-01", "10:00", 100, 2],
      ["2026-10-01", "17:00", 102, 1],
    ]);
  });
});
