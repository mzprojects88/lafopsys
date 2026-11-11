import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { countedDay, daysWaiting, durationWords, fundAllows, quarterOf, settledAdvances, settlement, trackSteps } from "../lib/utils/vouchers.ts";
import { escapeCsv } from "../lib/utils/csv.ts";

const ev = (action, at, actor = "a") => ({ action, at, actor, note: null });
const now = Date.parse("2026-11-12T08:00:00Z");

describe("vouchers: the step line", () => {
  it("marks the done steps, the one it waits for and how long it has waited", () => {
    const s = trackSteps("endorsed", [ev("submit", "2026-11-10T08:00:00Z"), ev("endorse", "2026-11-11T08:00:00Z", "b")], now);
    assert.deepEqual(s.map((x) => x.state), ["done", "done", "current", "todo", "todo", "todo", "todo", "todo"]);
    assert.equal(s[1].tookMs, 86_400_000);
    assert.equal(s[2].waitingMs, 86_400_000);
  });
  it("starts over after a request is sent back and sent again", () => {
    const s = trackSteps("submitted", [ev("submit", "2026-11-01T00:00:00Z"), ev("endorse", "2026-11-02T00:00:00Z"), ev("return", "2026-11-03T00:00:00Z"), ev("submit", "2026-11-04T00:00:00Z")], now);
    assert.deepEqual(s.map((x) => x.state), ["done", "current", "todo", "todo", "todo", "todo", "todo", "todo"]);
  });
  it("shows a skipped endorsement, and nothing current once it is final", () => {
    const s = trackSteps("rejected", [ev("submit", "2026-11-10T00:00:00Z"), ev("skip_endorse", "2026-11-10T00:00:00Z", null), ev("reject", "2026-11-11T00:00:00Z")], now);
    assert.equal(s[1].state, "skipped");
    assert.ok(s.every((x) => x.state !== "current"));
  });
  it("a draft has no steps done", () => {
    assert.deepEqual(trackSteps("draft", [], now).map((x) => x.state), ["todo", "todo", "todo", "todo", "todo", "todo", "todo", "todo"]);
    // Approved and waiting to be paid: the payment is current; a slip from a fund skips the two payment steps.
    const road = ["submit", "endorse", "prepare", "review", "approve"].map((a, n) => ev(a, `2026-11-0${n + 1}T00:00:00Z`));
    assert.equal(trackSteps("approved", road, now).find((x) => x.state === "current")?.label, "Payment prepared");
    assert.equal(trackSteps("approved", road, now, true).find((x) => x.state === "current")?.label, "Paid (released)");
    assert.equal(trackSteps("approved", road, now, true).length, 6);
  });
});

describe("vouchers: words and sums", () => {
  it("says how long", () => {
    assert.equal(durationWords(20 * 60_000), "under an hour");
    assert.equal(durationWords(3_600_000), "1 hour");
    assert.equal(durationWords(3 * 86_400_000), "3 days");
    assert.equal(daysWaiting("2026-11-10T09:00:00Z", now), 1);
  });
  it("spending counts on the Manila day Finance prepared it, and not before", () => {
    const none = new Set();
    const v = { id: "a", kind: "cash_advance", status: "approved", submittedAt: "2026-11-30T10:00:00Z", createdAt: "2026-11-29T10:00:00Z" };
    assert.equal(countedDay(v, "2026-12-31T18:00:00Z", none), "2027-01-01");
    assert.equal(countedDay(v, undefined, none), "2026-11-30");
    assert.equal(countedDay({ ...v, status: "submitted" }, undefined, none), null);
    // A top-up never counts; an advance stops counting once its liquidation is prepared.
    assert.equal(countedDay({ ...v, kind: "fund_topup" }, undefined, none), null);
    const settled = settledAdvances([v, { ...v, id: "l", kind: "liquidation", advanceOf: "a", status: "prepared" }]);
    assert.equal(countedDay(v, undefined, settled), null);
    assert.equal(settledAdvances([v, { ...v, id: "l", kind: "liquidation", advanceOf: "a", status: "draft" }]).size, 0);
  });
  it("settles an advance: change returned, overspend reimbursed", () => {
    assert.deepEqual(settlement(3000, 2600), { kind: "return", amount: 400 });
    assert.deepEqual(settlement(3000, 3150.5), { kind: "reimburse", amount: 150.5 });
    assert.deepEqual(settlement(3000, 3000), { kind: "even", amount: 0 });
  });
  it("names the quarter for the 2307", () => {
    assert.deepEqual(quarterOf("2026-11-12"), { key: "2026-Q4", from: "2026-10-01", to: "2026-12-31" });
    assert.deepEqual(quarterOf("2028-02-29"), { key: "2028-Q1", from: "2028-01-01", to: "2028-03-31" });
  });
  it("a restricted fund pays only its accounts; an empty list allows any", () => {
    assert.equal(fundAllows(["52", "5503"], "5202"), true);
    assert.equal(fundAllows(["52", "5503"], "5303"), false);
    assert.equal(fundAllows([], "5303"), true);
    assert.equal(fundAllows(["52"], null), false);
  });
});

describe("csv: no formulas", () => {
  it("defuses a formula but keeps negative numbers", () => {
    assert.equal(escapeCsv("=HYPERLINK(1)"), `"'=HYPERLINK(1)"`);
    assert.equal(escapeCsv("@SUM(A1)"), `"'@SUM(A1)"`);
    assert.equal(escapeCsv("-250.50"), `"-250.50"`);
    assert.equal(escapeCsv("-Credit"), `"'-Credit"`);
    assert.equal(escapeCsv('say "hi"'), `"say ""hi"""`);
  });
});
