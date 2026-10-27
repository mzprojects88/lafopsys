// Scheduled report delivery (0118): when a schedule is due, and which month a report covers.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isDue, isoWeekday, reportMonth, esc } from "../lib/notify/schedule.ts";

const base = { frequency: "monthly", day: 5, active: true, recipients: ["ceo@example.org"], last_sent_on: null };
describe("scheduled delivery", () => {
  it("is due on its day of the month, once", () => {
    assert.equal(isDue(base, "2026-11-05"), true);
    assert.equal(isDue(base, "2026-11-06"), false);
    assert.equal(isDue({ ...base, last_sent_on: "2026-11-05" }, "2026-11-05"), false);
    assert.equal(isDue({ ...base, active: false }, "2026-11-05"), false);
    assert.equal(isDue({ ...base, recipients: [] }, "2026-11-05"), false);
  });
  it("is due weekly on its weekday", () => {
    assert.equal(isoWeekday("2026-10-26"), 1); // a Monday
    assert.equal(isoWeekday("2026-11-01"), 7); // a Sunday
    assert.equal(isDue({ ...base, frequency: "weekly", day: 1 }, "2026-10-26"), true);
    assert.equal(isDue({ ...base, frequency: "weekly", day: 1 }, "2026-10-27"), false);
  });
  it("reports on the previous month, across the new year", () => {
    assert.equal(reportMonth("2026-11-05"), "2026-10");
    assert.equal(reportMonth("2027-01-01"), "2026-12");
  });
  it("escapes text for the email", () => {
    assert.equal(esc(`<b>"A & B"</b>`), "&lt;b&gt;&quot;A &amp; B&quot;&lt;/b&gt;");
  });
});
