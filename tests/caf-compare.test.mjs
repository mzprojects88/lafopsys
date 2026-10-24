// lib/utils/caf-compare.ts: the CAF Record tab against the app's bill (compare only).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cafRecordLines, compareCaf } from "../lib/utils/caf-compare.ts";

const header = ["PATIENT NAME", "DATE", "", "", "PATIENT NAME", "DATE", "", ""];

describe("cafRecordLines", () => {
  it("reads name rows followed by date rows, one block per month", () => {
    const rows = [
      header,
      ["Alpha, Test", "Jan 12", "", "", "Beta, Test", "Feb 3", "", ""],
      ["", "Jan 13", "", "", "", "Feb 4", "", ""],
      ["Beta, Test", "Jan 20", "", "", "", "", "", ""],
      ["", "Jan 20", "", "", "", "Mar 9", "", ""], // a repeat is kept once; a March date in the February block is ignored
    ];
    const m = cafRecordLines(rows, 2026);
    assert.deepEqual(
      m["2026-01"].map((l) => [l.nameKey, l.dates]),
      [
        ["alpha|test", ["2026-01-12", "2026-01-13"]],
        ["beta|test", ["2026-01-20"]],
      ]
    );
    assert.deepEqual(m["2026-02"].map((l) => [l.nameKey, l.dates]), [["beta|test", ["2026-02-03", "2026-02-04"]]]);
  });
});

describe("compareCaf", () => {
  it("splits each child's nights into sheet-only, bill-only and both; unmatched names are counted", () => {
    const { rows, unmatched } = compareCaf(
      [
        { patientId: "p1", dates: ["2026-01-12", "2026-01-13"] },
        { patientId: "p1", dates: ["2026-01-14"] },
        { patientId: null, dates: ["2026-01-20"] },
      ],
      [
        { patientId: "p1", nights: ["2026-01-13", "2026-01-14", "2026-01-15"] },
        { patientId: "p2", nights: ["2026-01-02"] },
      ]
    );
    assert.equal(unmatched, 1);
    assert.deepEqual(rows.find((r) => r.patientId === "p1"), { patientId: "p1", sheetOnly: ["2026-01-12"], billOnly: ["2026-01-15"], both: 2 });
    assert.deepEqual(rows.find((r) => r.patientId === "p2"), { patientId: "p2", sheetOnly: [], billOnly: ["2026-01-02"], both: 0 });
  });
});
