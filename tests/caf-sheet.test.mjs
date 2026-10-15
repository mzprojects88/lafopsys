// lib/utils/caf-sheet.ts: nights from the House Sheet's daily tabs onto the NCH bill.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mergeNights, sheetNights } from "../lib/utils/caf-sheet.ts";

describe("nights from the House Sheet", () => {
  const ids = { "Abines, Cassiah": "p1", "Alday, Chaze": "p2" };
  const resolve = (name) => ids[name] ?? null;
  it("collects each child's days and the names nobody matched", () => {
    const r = sheetNights(
      [
        { date: "2026-10-02", names: ["Abines, Cassiah", "Stranger, A"] },
        { date: "2026-10-01", names: ["Abines, Cassiah", "Alday, Chaze", "Abines, Cassiah"] },
      ],
      resolve
    );
    assert.deepEqual(r.nights.get("p1"), ["2026-10-01", "2026-10-02"]);
    assert.deepEqual(r.nights.get("p2"), ["2026-10-01"]);
    assert.deepEqual(r.unmatched, ["Stranger, A"]);
  });
  it("adds only nights the bill doesn't have", () => {
    assert.deepEqual(mergeNights(["2026-10-13", "2026-10-14"], ["2026-10-01", "2026-10-13"]), { all: ["2026-10-01", "2026-10-13", "2026-10-14"], added: ["2026-10-01"] });
    assert.deepEqual(mergeNights(["2026-10-13"], ["2026-10-13"]).added, []);
  });
});
