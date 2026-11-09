import { test } from "node:test";
import assert from "node:assert/strict";
import { bucketOf, daysOf, parsePreset, presetLabel, presetQuery, presetWindow } from "../lib/utils/period-presets.ts";

test("chart days and buckets", () => {
  assert.deepEqual(daysOf({ from: "2026-10-30", to: "2026-11-02" }), ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
  assert.equal(daysOf({ from: "2026-01-01", to: "2030-12-31" }).length, 1100);
  assert.equal(bucketOf("2026-11-15", "week"), "2026-11-09");
  assert.equal(bucketOf("2026-11-15", "month"), "2026-11");
  assert.equal(bucketOf("2026-11-15", "day"), "2026-11-15");
});

const w = (key, today, extra = {}) => presetWindow({ key, ...extra }, today);

test("today and yesterday, across a month and a year edge", () => {
  assert.deepEqual(w("today", "2026-11-10"), { from: "2026-11-10", to: "2026-11-10" });
  assert.deepEqual(w("yesterday", "2026-11-01"), { from: "2026-10-31", to: "2026-10-31" });
  assert.deepEqual(w("yesterday", "2027-01-01"), { from: "2026-12-31", to: "2026-12-31" });
});

test("weeks start on Monday; last week is the seven days before this one", () => {
  // Tue 10 Nov 2026
  assert.deepEqual(w("this_week", "2026-11-10"), { from: "2026-11-09", to: "2026-11-15" });
  assert.deepEqual(w("last_week", "2026-11-10"), { from: "2026-11-02", to: "2026-11-08" });
  // Sunday belongs to the week that began the Monday before
  assert.deepEqual(w("this_week", "2026-11-15"), { from: "2026-11-09", to: "2026-11-15" });
  // Monday starts a new week
  assert.deepEqual(w("last_week", "2026-11-16"), { from: "2026-11-09", to: "2026-11-15" });
});

test("months, including a leap February and January's last month", () => {
  assert.deepEqual(w("this_month", "2026-11-10"), { from: "2026-11-01", to: "2026-11-30" });
  assert.deepEqual(w("last_month", "2028-03-31"), { from: "2028-02-01", to: "2028-02-29" });
  assert.deepEqual(w("last_month", "2027-01-15"), { from: "2026-12-01", to: "2026-12-31" });
});

test("custom range, all time, and a broken custom range", () => {
  assert.deepEqual(w("custom", "2026-11-10", { from: "2026-10-03", to: "2026-11-02" }), { from: "2026-10-03", to: "2026-11-02" });
  assert.equal(w("all", "2026-11-10"), null);
  assert.deepEqual(w("custom", "2026-11-10", { from: "2026-11-05", to: "2026-11-01" }), { from: "2026-11-01", to: "2026-11-30" });
});

test("the address round-trips, and an unknown or disallowed period falls back", () => {
  const params = (q) => (k) => new URLSearchParams(q).get(k);
  assert.deepEqual(parsePreset(params("period=last_week"), "this_month"), { key: "last_week" });
  assert.deepEqual(parsePreset(params("period=custom&from=2026-10-01&to=2026-10-15"), "today"), { key: "custom", from: "2026-10-01", to: "2026-10-15" });
  assert.deepEqual(parsePreset(params("period=bogus"), "today"), { key: "today" });
  assert.deepEqual(parsePreset(params("period=all"), "this_month"), { key: "this_month" });
  assert.deepEqual(parsePreset(params("period=all"), "this_month", true), { key: "all" });
  assert.deepEqual(presetQuery({ key: "custom", from: "2026-10-01", to: "2026-10-15" }), { period: "custom", from: "2026-10-01", to: "2026-10-15" });
  assert.deepEqual(presetQuery({ key: "this_week" }), { period: "this_week" });
});

test("captions", () => {
  assert.equal(presetLabel({ key: "this_month" }, w("this_month", "2026-11-10")), "This month · Nov 2026");
  assert.equal(presetLabel({ key: "yesterday" }, w("yesterday", "2026-11-10")), "Yesterday · Nov 9, 2026");
  assert.equal(presetLabel({ key: "last_week" }, w("last_week", "2026-11-10")), "Last week · Nov 2 – Nov 8, 2026");
  assert.equal(presetLabel({ key: "custom", from: "2026-10-03", to: "2026-11-02" }, w("custom", "2026-11-10", { from: "2026-10-03", to: "2026-11-02" })), "Oct 3 – Nov 2, 2026");
  assert.equal(presetLabel({ key: "all" }, null), "All time");
});
