// lib/utils/menu-week-ui.ts (0120 / Inventory 0068): the same file as laf-inventory's, so the
// Weekly Menu reads alike in both apps.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dietLabel, stockStatus, weekStatus, weekStock } from "../lib/utils/menu-week-ui.ts";
import { mondayOf, weekDates } from "../lib/ai/menu-week.ts";

const meal = (o) => ({ id: "m", date: "2026-11-02", mealType: "lunch", status: "draft", servings: 20, dish: "Tinola", recipeId: "r", ingredients: [], source: "ai", alternatives: [], dietCheck: null, notes: "", approvedBy: null, reviewNote: null, ...o });

describe("the weekly menu", () => {
  it("has one status for the week", () => {
    assert.equal(weekStatus([]), "empty");
    assert.equal(weekStatus([meal({ status: "pending_nutritionist" })]), "pending");
    assert.equal(weekStatus([meal({ status: "approved" }), meal({ status: "draft" })]), "draft");
    assert.equal(weekStatus([meal({ status: "approved" }), meal({ status: "rejected" })]), "rejected");
  });
  it("charges stock across the week in date order", () => {
    const onHand = new Map([["rice", 5]]);
    const mon = meal({ id: "a", date: "2026-11-02", ingredients: [{ itemId: "rice", perServing: 0.1 }], servings: 30 });
    const tue = meal({ id: "b", date: "2026-11-03", ingredients: [{ itemId: "rice", perServing: 0.1 }], servings: 30 });
    const out = weekStock([tue, mon], onHand);
    assert.deepEqual(out.get("a"), { status: "covered", short: [] });
    assert.deepEqual(out.get("b"), { status: "short", short: ["rice"] });
    assert.equal(stockStatus(meal({ ingredients: [{ itemId: "rice" }] }), onHand).status, "unknown");
  });
  it("labels the diet check", () => {
    assert.equal(dietLabel(meal({})).label, "Not checked");
    assert.equal(dietLabel(meal({ dietCheck: { status: "alternative", notes: [{ label: "Person 1", issue: "dairy" }] } })).label, "1 needs an alternative");
  });
  it("runs Monday to Sunday", () => {
    assert.equal(mondayOf("2026-10-28"), "2026-10-26");
    assert.equal(mondayOf("2026-10-26"), "2026-10-26");
    assert.deepEqual(weekDates("2026-10-26").slice(-1), ["2026-11-01"]);
  });
  it("is the same file in both apps", () => {
    for (const f of ["lib/utils/menu-week-ui.ts", "lib/ai/menu-week.ts"]) {
      assert.equal(readFileSync(new URL(`../${f}`, import.meta.url), "utf8").replace(/\r\n/g, "\n"), readFileSync(new URL(`../../laf-inventory/${f}`, import.meta.url), "utf8").replace(/\r\n/g, "\n"), `${f} differs`);
    }
  });
});
