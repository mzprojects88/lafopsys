// lib/utils/dashboard-catalog.ts (0147): what a person's dashboard shows.
import { it } from "node:test";
import assert from "node:assert/strict";
import { ACTIONS, CARDS, move, resolveLayout } from "../lib/utils/dashboard-catalog.ts";

const all = new Set(CARDS.map((c) => c.key));
const program = new Set(["housing", "rides", "meals", "child_visits", "care_cart", "patients", "in_house"]);
const any = () => true;

it("with nothing saved: the main cards the profile has, and the roles' default actions", () => {
  const r = resolveLayout(null, program, ["driver"], any);
  assert.deepEqual(r.cards, ["housing", "rides", "meals", "child_visits", "care_cart", "patients"]);
  assert.ok(r.actions.includes("log_fuel") && !r.actions.includes("ledger"));
  assert.equal(r.period, "this_year");
});

it("keeps the person's order, drops cards the profile lost and actions they can't use", () => {
  const saved = { cards: ["cash", "meals", "in_house", "nonsense"], actions: ["ledger", "log_fuel"], period: "today" };
  const r = resolveLayout(saved, program, ["driver"], (a) => a.key !== "ledger");
  assert.deepEqual(r.cards, ["meals", "in_house"]);
  assert.deepEqual(r.actions, ["log_fuel"]);
  assert.equal(r.period, "today");
  assert.equal(resolveLayout(saved, all, [], any).cards.length, 3);
});

it("never more than 8 actions, and moves stay inside the list", () => {
  assert.ok(resolveLayout({ cards: [], actions: ACTIONS.map((a) => a.key), period: "this_year" }, all, [], any).actions.length <= 8);
  assert.deepEqual(move(["a", "b", "c"], "c", 1), ["a", "b", "c"]);
  assert.deepEqual(move(["a", "b", "c"], "b", -1), ["b", "a", "c"]);
});
