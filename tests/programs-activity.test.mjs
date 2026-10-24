// lib/utils/programs-activity.ts (0107): the Activity Center tab of the LAF Programs sheet.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { activitySessions } from "../lib/utils/programs-activity.ts";

const header = ["MONTH", "WEEK", "DATE", "TIME", "NCH NAMES", "NCH #", "NCH HOURS", "NCH VOL NAMES", "NCH # VOL", "", "LAF NAMES", "LAF #", "LAF # VOL", "LAF VOL NAMES"];
const row = (date, time, nch, hours, nchVol, laf, lafVol) => ["MAR", "WEEK 13", date, time, "", nch, hours, "", nchVol, "", "", laf, lafVol, ""];

describe("activitySessions", () => {
  it("one session per dated row and site with a participant count; rows without counts or a date are skipped", () => {
    const rows = [
      header,
      row("3/30/2026", "1:00 PM - 3:00 PM", "15.00", "3.00", "2", "", ""),
      row("3/31/2026", "1:00 PM - 3:00 PM", "29.00", "5.00", "", "6", "1"),
      row("", "", "10", "2", "", "", ""), // no date: a names-only continuation row
      row("4/6/2026", "", "", "", "", "", ""), // a date with nothing counted
      row("3/30/2026", "", "99", "9", "", "", ""), // a repeat of a day and site: the first row wins
    ];
    const s = activitySessions(rows);
    assert.deepEqual(
      s.map((x) => [x.sheetKey, x.participants, x.volunteers, x.hours, x.time]),
      [
        ["2026-03-30|NCH", 15, 2, 3, "1:00 PM - 3:00 PM"],
        ["2026-03-31|NCH", 29, 0, 5, "1:00 PM - 3:00 PM"],
        ["2026-03-31|LAF", 6, 1, 0, "1:00 PM - 3:00 PM"],
      ]
    );
  });
});
