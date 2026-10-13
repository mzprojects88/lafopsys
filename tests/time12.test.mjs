import { test } from "node:test";
import assert from "node:assert/strict";
import { formatTime12 } from "../lib/utils/time12.ts";

test("times print in the 12-hour clock", () => {
  assert.equal(formatTime12("06:00"), "6:00 AM");
  assert.equal(formatTime12("18:00"), "6:00 PM");
  assert.equal(formatTime12("00:30"), "12:30 AM");
  assert.equal(formatTime12("12:05:00"), "12:05 PM");
  assert.equal(formatTime12(""), "—");
});

test("an instant prints in the 12-hour clock, Manila time, across midnight", async () => {
  const { timeLabel, timeLabel12 } = await import("../lib/utils/dtr.ts");
  // 16:05Z is 12:05 AM the next day in Manila; storage keeps HH:mm.
  assert.equal(timeLabel12("2026-10-13T16:05:00Z"), "12:05 AM");
  assert.equal(timeLabel("2026-10-13T16:05:00Z"), "00:05");
  assert.equal(timeLabel12("2026-10-14T10:00:00Z"), "6:00 PM");
});
