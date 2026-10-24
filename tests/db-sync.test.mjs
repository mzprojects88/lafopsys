// lib/utils/db-sync.ts (0104): the two-way sync's decisions, production wins.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decide } from "../lib/utils/db-sync.ts";

const m = (o) => new Map(Object.entries(o));
const keys = (d) => ({ toDev: d.toDev, toProd: d.toProd, deleteOnDev: d.deleteOnDev, deleteOnProd: d.deleteOnProd, conflicts: d.conflicts.map((c) => `${c.pk}:${c.what}`), agreed: Object.fromEntries(d.agreed) });

describe("two-way sync decisions", () => {
  it("same on both: nothing to do, recorded as agreed", () => {
    assert.deepEqual(keys(decide(m({}), m({ a: "1" }), m({ a: "1" }))), { toDev: [], toProd: [], deleteOnDev: [], deleteOnProd: [], conflicts: [], agreed: { a: "1" } });
  });
  it("changed on one side only goes to the other -- dev's change included", () => {
    assert.deepEqual(keys(decide(m({ a: "1", b: "1" }), m({ a: "2", b: "1" }), m({ a: "1", b: "3" }))), { toDev: ["a"], toProd: ["b"], deleteOnDev: [], deleteOnProd: [], conflicts: [], agreed: { a: "2", b: "3" } });
  });
  it("changed on both: production kept, logged", () => {
    assert.deepEqual(keys(decide(m({ a: "1" }), m({ a: "2" }), m({ a: "3" }))), { toDev: ["a"], toProd: [], deleteOnDev: [], deleteOnProd: [], conflicts: ["a:production kept"], agreed: { a: "2" } });
  });
  it("differ with no record of agreement (first run): production kept", () => {
    assert.deepEqual(keys(decide(m({}), m({ a: "2" }), m({ a: "3" }))).conflicts, ["a:production kept"]);
  });
  it("new on either side is added to the other", () => {
    assert.deepEqual(keys(decide(m({}), m({ p: "1" }), m({ d: "1" }))), { toDev: ["p"], toProd: ["d"], deleteOnDev: [], deleteOnProd: [], conflicts: [], agreed: { p: "1", d: "1" } });
  });
  it("deleted on one side, untouched on the other: deleted there too", () => {
    assert.deepEqual(keys(decide(m({ a: "1", b: "1" }), m({ a: "1" }), m({ b: "1" }))), { toDev: [], toProd: [], deleteOnDev: ["b"], deleteOnProd: ["a"], conflicts: [], agreed: {} });
  });
  it("dev deleted what production changed: production's row comes back to dev", () => {
    assert.deepEqual(keys(decide(m({ a: "1" }), m({ a: "2" }), m({}))), { toDev: ["a"], toProd: [], deleteOnDev: [], deleteOnProd: [], conflicts: ["a:production kept"], agreed: { a: "2" } });
  });
  it("production deleted what dev changed: production's deletion stands", () => {
    assert.deepEqual(keys(decide(m({ a: "1" }), m({}), m({ a: "2" }))), { toDev: [], toProd: [], deleteOnDev: ["a"], deleteOnProd: [], conflicts: ["a:production deletion stands"], agreed: {} });
  });
  it("gone from both leaves the state", () => {
    assert.deepEqual(keys(decide(m({ a: "1" }), m({}), m({}))).agreed, {});
  });
});
