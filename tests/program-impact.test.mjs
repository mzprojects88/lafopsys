// lib/utils/program-impact.ts (0112): the Programs report's arithmetic.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cell, impactCsv, lineStatus, shown, ytd } from "../lib/utils/program-impact.ts";

const rows = [
  { line: "housing", month: 1, native: 0, fromSheet: 396 },
  { line: "housing", month: 2, native: 10, fromSheet: 344 },
  { line: "housing", month: 3, native: 540, fromSheet: 540 },
  { line: "care_cart_1000", month: 1, native: 0, fromSheet: 100 },
  { line: "transport_to_nch", month: 3, native: 4, fromSheet: 0 },
];

describe("program impact", () => {
  it("shows the larger of app and sheet, and sums YTD on that", () => {
    assert.equal(shown(cell(rows, "housing", 2)), 344);
    assert.equal(ytd(rows, "housing", 3), 396 + 344 + 540);
    assert.equal(ytd(rows, "housing", 3, (r) => r.native), 550);
    assert.deepEqual(cell(rows, "housing", 7), { line: "housing", month: 7, native: 0, fromSheet: 0 });
  });
  it("judges a line on the current month", () => {
    assert.equal(lineStatus(rows, "housing", 2), "catching_up");
    assert.equal(lineStatus(rows, "housing", 3), "live");
    assert.equal(lineStatus(rows, "care_cart_1000", 1), "not_encoded");
    assert.equal(lineStatus(rows, "transport_to_nch", 3), "live");
    assert.equal(lineStatus(rows, "caf_nights", 3), "sheet_only");
  });
  it("writes the grid as CSV with app and sheet columns", () => {
    const csv = impactCsv(rows, 2026, 2);
    const lines = csv.split("\n");
    assert.equal(lines[0], '"Group","Line","Unit","Jan 2026 (app)","Jan 2026 (sheet)","Feb 2026 (app)","Feb 2026 (sheet)","YTD (shown)"');
    assert.ok(lines[1].startsWith('"Housing","People housed (child + companions, per night)","people-nights",0,396,10,344,740'));
  });
});
