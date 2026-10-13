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
