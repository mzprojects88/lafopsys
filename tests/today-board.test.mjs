// Unit tests for lib/utils/today-board.ts -- the supervisor's today board (DTR phase 3).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { boardStatus } from "../lib/utils/today-board.ts";

// Manila 08:00 = 00:00Z.
const base = { day: "2026-09-24", shift: { start: "08:00", end: "17:00" }, graceMinutes: 10 };
const at = (hhmmZ) => new Date(`2026-09-24T${hhmmZ}:00.000Z`);

describe("boardStatus", () => {
  it("before the shift (and grace) it is only due", () => {
    assert.deepEqual(boardStatus({ ...base, clockIn: null, clockOut: null, now: at("00:09") }), { status: "due", lateMinutes: 0 });
  });
  it("past the grace period with no clock-in, missing", () => {
    assert.equal(boardStatus({ ...base, clockIn: null, clockOut: null, now: at("00:11") }).status, "missing");
  });
  it("in within the grace period is not late; after it, the whole lateness counts", () => {
    assert.deepEqual(boardStatus({ ...base, clockIn: "08:10", clockOut: null, now: at("02:00") }), { status: "in", lateMinutes: 0 });
    assert.deepEqual(boardStatus({ ...base, clockIn: "08:25", clockOut: null, now: at("02:00") }), { status: "in", lateMinutes: 25 });
  });
  it("still in after the shift ended", () => {
    assert.equal(boardStatus({ ...base, clockIn: "08:00", clockOut: null, now: at("09:30") }).status, "overdue");
  });
  it("clocked out", () => {
    assert.deepEqual(boardStatus({ ...base, clockIn: "08:00", clockOut: "17:00", now: at("09:30") }), { status: "out", lateMinutes: 0 });
  });
});
