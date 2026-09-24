// Unit tests for lib/utils/dtr-prompts.ts -- the clock-out reminder and the forgotten-day prompt.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { clockOutDueAt, forgottenDays, instantOn } from "../lib/utils/dtr-prompts.ts";

describe("clockOutDueAt", () => {
  it("the scheduled end, in Manila time", () => {
    assert.equal(clockOutDueAt("2026-09-24", "08:02", { start: "08:00", end: "17:00" }).toISOString(), "2026-09-24T09:00:00.000Z");
  });
  it("a night shift ends the next morning", () => {
    assert.equal(clockOutDueAt("2026-09-24", "22:00", { start: "22:00", end: "06:00" }).toISOString(), "2026-09-24T22:00:00.000Z");
  });
  it("no schedule: nine hours after clocking in", () => {
    assert.equal(clockOutDueAt("2026-09-24", "08:30", null).toISOString(), "2026-09-24T09:30:00.000Z");
  });
  it("instants are Manila", () => {
    assert.equal(instantOn("2026-09-24", "00:00").toISOString(), "2026-09-23T16:00:00.000Z");
  });
});

describe("forgottenDays", () => {
  const e = (id, date, clockOut = null, staffId = "me") => ({ id, staffId, date, clockIn: "08:00", clockOut });
  const entries = [e("a", "2026-09-20"), e("b", "2026-09-23"), e("c", "2026-09-24"), e("d", "2026-09-19", "17:00"), e("x", "2026-09-18", null, "other")];
  it("open days before today, oldest first; yesterday may still be on duty", () => {
    const days = forgottenDays("me", entries, [], "2026-09-24");
    assert.deepEqual(days.map((d) => [d.entry.id, d.mayStillBeOnDuty]), [["a", false], ["b", true]]);
  });
  it("a day already asked about is left alone, unless the request was rejected", () => {
    const pending = [{ timeEntryId: "a", punchType: "clock_out", status: "pending" }];
    assert.deepEqual(forgottenDays("me", entries, pending, "2026-09-24").map((d) => d.entry.id), ["b"]);
    const rejected = [{ timeEntryId: "a", punchType: "clock_out", status: "rejected" }];
    assert.deepEqual(forgottenDays("me", entries, rejected, "2026-09-24").map((d) => d.entry.id), ["a", "b"]);
  });
});
