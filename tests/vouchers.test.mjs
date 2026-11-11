import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { countedDay, daysWaiting, durationWords, fundAllows, shownAmount, trackSteps } from "../lib/utils/vouchers.ts";
import { escapeCsv } from "../lib/utils/csv.ts";

const ev = (action, at, actor = "a") => ({ action, at, actor, note: null });
const now = Date.parse("2026-11-12T08:00:00Z");

describe("vouchers: the step line", () => {
  it("marks the done steps, the one it waits for and how long it has waited", () => {
    const s = trackSteps("endorsed", [ev("submit", "2026-11-10T08:00:00Z"), ev("endorse", "2026-11-11T08:00:00Z", "b")], now);
    assert.deepEqual(s.map((x) => x.state), ["done", "done", "current", "todo", "todo"]);
    assert.equal(s[1].tookMs, 86_400_000);
    assert.equal(s[2].waitingMs, 86_400_000);
  });
  it("starts over after a request is sent back and sent again", () => {
    const s = trackSteps("submitted", [ev("submit", "2026-11-01T00:00:00Z"), ev("endorse", "2026-11-02T00:00:00Z"), ev("return", "2026-11-03T00:00:00Z"), ev("submit", "2026-11-04T00:00:00Z")], now);
    assert.deepEqual(s.map((x) => x.state), ["done", "current", "todo", "todo", "todo"]);
  });
  it("shows a skipped endorsement, and nothing current once it is final", () => {
    const s = trackSteps("rejected", [ev("submit", "2026-11-10T00:00:00Z"), ev("skip_endorse", "2026-11-10T00:00:00Z", null), ev("reject", "2026-11-11T00:00:00Z")], now);
    assert.equal(s[1].state, "skipped");
    assert.ok(s.every((x) => x.state !== "current"));
  });
  it("a draft has no steps done", () => {
    assert.deepEqual(trackSteps("draft", [], now).map((x) => x.state), ["todo", "todo", "todo", "todo", "todo"]);
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
    const v = { status: "approved", submittedAt: "2026-11-30T10:00:00Z", createdAt: "2026-11-29T10:00:00Z" };
    assert.equal(countedDay(v, "2026-12-31T18:00:00Z"), "2027-01-01");
    assert.equal(countedDay(v, undefined), "2026-11-30");
    assert.equal(countedDay({ ...v, status: "submitted" }, undefined), null);
  });
  it("a restricted fund pays only its accounts; an empty list allows any", () => {
    assert.equal(fundAllows(["52", "5503"], "5202"), true);
    assert.equal(fundAllows(["52", "5503"], "5303"), false);
    assert.equal(fundAllows([], "5303"), true);
    assert.equal(fundAllows(["52"], null), false);
  });
  it("with a code filter, a request counts only its matching lines", () => {
    const lines = [{ amount: 100, code: "5303" }, { amount: 50, code: "5934" }];
    assert.equal(shownAmount(150, lines, null), 150);
    assert.equal(shownAmount(150, lines, (l) => l.code === "5303"), 100);
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
