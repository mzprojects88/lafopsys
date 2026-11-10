import { test } from "node:test";
import assert from "node:assert/strict";
import { ALL, optionsOf, passes, words } from "../lib/utils/filters.ts";

test("filter options come from the values the rows hold, readable and sorted", () => {
  const rows = [{ s: "ongoing" }, { s: "lost_to_follow_up" }, { s: "ongoing" }, { s: "" }, { s: null }, {}];
  assert.equal(words("lost_to_follow_up"), "Lost to follow up");
  assert.deepEqual(optionsOf(rows, (r) => r.s), [
    { value: "lost_to_follow_up", label: "Lost to follow up" },
    { value: "ongoing", label: "Ongoing" },
  ]);
  assert.deepEqual(optionsOf([{ c: "US_501C3" }, { c: "PH_SEC" }], (r) => r.c, (v) => (v === "PH_SEC" ? "PH" : "US")), [
    { value: "PH_SEC", label: "PH" },
    { value: "US_501C3", label: "US" },
  ]);
});

test("a filter passes everything at All, else only its own value", () => {
  assert.equal(passes(ALL, "x"), true);
  assert.equal(passes(ALL, undefined), true);
  assert.equal(passes("x", "x"), true);
  assert.equal(passes("x", "y"), false);
  assert.equal(passes("x", null), false);
});
