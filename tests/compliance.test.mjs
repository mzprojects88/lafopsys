// lib/utils/compliance.ts -- due rules, the calendar, headcount thresholds.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { complianceCalendar, dueDatesFor, headcountThresholds, monthlyRemittanceDeadlines, pagibigDueDay, parseDueRule, philhealthDueDay, reportSourceFor, rollBack, rollForward, targetFor, yearEndDeadlines, REPORT_SOURCES } from "../lib/utils/compliance.ts";

const HOLIDAYS = [
  { date: "2026-08-31", kind: "regular" },
  { date: "2026-11-30", kind: "regular" },
  { date: "2026-12-25", kind: "regular" },
  { date: "2026-12-30", kind: "regular" },
  { date: "2027-01-01", kind: "regular" },
];
const ctx = (patch = {}) => ({ penLastDigit: null, employerInitial: null, trackingFrom: "2026-01-01", holidays: HOLIDAYS, ...patch });
const item = (code, dueRule, patch = {}) => ({ id: `i-${code}`, code, agency: "BIR", name: code, form: null, category: "employment", frequency: "monthly", dueRule, applies: "yes", active: true, ...patch });
const WINDOW = { from: "2026-01-01", to: "2026-12-31" };

describe("rollForward", () => {
  it("weekend and holiday roll to the next business day", () => {
    assert.equal(rollForward("2026-10-10", HOLIDAYS), "2026-10-12"); // Saturday -> Monday
    assert.equal(rollForward("2026-11-30", HOLIDAYS), "2026-12-01"); // Bonifacio Day (Mon)
    assert.equal(rollForward("2026-09-10", HOLIDAYS), "2026-09-10"); // Thursday
  });
});

describe("dueDatesFor", () => {
  it("1601-C: 10th of the following month, December on Jan 15", () => {
    const d = dueDatesFor(item("bir_1601c", { kind: "day_of_month", day: 10, december: { month: 1, day: 15 } }), WINDOW, ctx());
    assert.equal(d.length, 12);
    assert.equal(d.find((x) => x.periodKey === "2026-08").dueOn, "2026-09-10");
    assert.equal(d.find((x) => x.periodKey === "2026-09").dueRaw, "2026-10-10");
    assert.equal(d.find((x) => x.periodKey === "2026-09").dueOn, "2026-10-12");
    assert.equal(d.find((x) => x.periodKey === "2026-12").dueOn, "2027-01-15");
  });
  it("SSS: last day of the following month; August -> Sep 30", () => {
    const d = dueDatesFor(item("sss_prn", { kind: "last_day_next_month" }), WINDOW, ctx());
    assert.equal(d.find((x) => x.periodKey === "2026-08").dueOn, "2026-09-30");
    assert.equal(d.find((x) => x.periodKey === "2026-01").dueOn, "2026-03-02"); // Feb 28 is a Saturday
  });
  it("PhilHealth and Pag-IBIG wait for the PEN digit and the initial", () => {
    assert.equal(dueDatesFor(item("philhealth_eprs", { kind: "pen_digit" }), WINDOW, ctx()).length, 0);
    const ph = dueDatesFor(item("philhealth_eprs", { kind: "pen_digit" }), WINDOW, ctx({ penLastDigit: 7 }));
    assert.equal(ph.find((x) => x.periodKey === "2026-08").dueOn, "2026-09-21"); // 20th is a Sunday
    const pi = dueDatesFor(item("pagibig_mcrf", { kind: "employer_initial" }), WINDOW, ctx({ employerInitial: "L" }));
    assert.equal(pi.find((x) => x.periodKey === "2026-08").dueOn, "2026-09-21"); // 19th is a Saturday
    assert.equal(philhealthDueDay(4), 15);
    assert.equal(philhealthDueDay(5), 20);
    assert.equal(pagibigDueDay("Little Ark", 2026, 9), 19);
    assert.equal(pagibigDueDay("Z", 2026, 9), 30);
  });
  it("quarterly: 1702Q 60 days after Q1-Q3 only; 2551Q the 25th after every quarter; 1601-EQ month-end", () => {
    const q = dueDatesFor(item("bir_1702q", { kind: "quarterly", offsetDays: 60, quarters: [1, 2, 3] }, { frequency: "quarterly" }), WINDOW, ctx());
    assert.deepEqual(q.map((x) => x.periodKey), ["2026-Q1", "2026-Q2", "2026-Q3"]);
    assert.equal(q[1].dueOn, "2026-09-01"); // Jun 30 + 60 = Aug 29 (Sat) -> Mon Aug 31 is National Heroes Day -> Sep 1
    const p = dueDatesFor(item("bir_2551q", { kind: "quarterly", day: 25 }, { frequency: "quarterly" }), WINDOW, ctx());
    assert.equal(p.length, 4);
    assert.equal(p.find((x) => x.periodKey === "2026-Q4").dueOn, "2027-01-25");
    const e = dueDatesFor(item("bir_1601eq", { kind: "quarterly", monthEnd: true }, { frequency: "quarterly" }), WINDOW, ctx());
    assert.equal(e.find((x) => x.periodKey === "2026-Q3").dueOn, "2026-11-02"); // Oct 31 is a Saturday
  });
  it("annual with a year offset: 1604-C for 2026 is due Jan 31, 2027 (a Sunday -> Feb 1)", () => {
    const d = dueDatesFor(item("bir_1604c", { kind: "fixed", month: 1, day: 31, yearOffset: 1 }, { frequency: "annual" }), WINDOW, ctx());
    assert.equal(d.length, 1);
    assert.equal(d[0].periodKey, "2026");
    assert.equal(d[0].dueOn, "2027-02-01");
  });
  it("tracking start hides obligations that fell due before it, by due date not period", () => {
    const d = dueDatesFor(item("bir_1601c", { kind: "day_of_month", day: 10 }), WINDOW, ctx({ trackingFrom: "2026-09-01" }));
    assert.deepEqual(d.map((x) => x.periodKey), ["2026-08", "2026-09", "2026-10", "2026-11", "2026-12"]);
    // Last year's annual report, due this August, is still shown.
    const aerw = dueDatesFor(item("dole_aerw", { kind: "fixed", month: 8, day: 31, yearOffset: 1 }, { frequency: "annual" }), { from: "2025-01-01", to: "2026-12-31" }, ctx({ trackingFrom: "2026-08-01" }));
    assert.deepEqual(aerw.map((x) => x.periodKey), ["2025", "2026"]);
  });
  it("as-needed items produce nothing", () => {
    assert.equal(dueDatesFor(item("sec_amend", { kind: "as_needed" }, { frequency: "as_needed" }), WINDOW, ctx()).length, 0);
  });
});

describe("parseDueRule", () => {
  it("accepts the known shapes and refuses the rest", () => {
    assert.deepEqual(parseDueRule({ kind: "fixed", month: 1, day: 31, yearOffset: 1 }), { kind: "fixed", month: 1, day: 31, yearOffset: 1 });
    assert.deepEqual(parseDueRule({ kind: "quarterly", offsetDays: 60, quarters: [1, 2, 3] }), { kind: "quarterly", offsetDays: 60, quarters: [1, 2, 3] });
    assert.throws(() => parseDueRule({ kind: "fixed", month: 13, day: 1 }));
    assert.throws(() => parseDueRule({ kind: "quarterly" }));
    assert.throws(() => parseDueRule({ kind: "weekly" }));
  });
});

describe("complianceCalendar", () => {
  const items = [item("bir_1601c", { kind: "day_of_month", day: 10, december: { month: 1, day: 15 } }), item("sss_prn", { kind: "last_day_next_month" }), item("off", { kind: "last_day_next_month" }, { active: false })];
  it("status by filing and by date", () => {
    const filings = [
      { itemId: "i-bir_1601c", periodKey: "2026-07", status: "filed", filedOn: "2026-08-10" },
      { itemId: "i-bir_1601c", periodKey: "2026-06", status: "filed", filedOn: "2026-07-14" },
      { itemId: "i-sss_prn", periodKey: "2026-08", status: "in_progress", filedOn: null },
    ];
    const cal = complianceCalendar(items, filings, WINDOW, ctx(), "2026-09-08");
    const get = (code, key) => cal.find((c) => c.code === code && c.periodKey === key);
    assert.equal(get("bir_1601c", "2026-07").status, "filed");
    assert.equal(get("bir_1601c", "2026-06").status, "late");
    // The August return: BIR date Sep 10, the foundation's own target Aug 28 (Aug 31 is a holiday, so the 10-day lead rolls back to the Friday).
    const aug = get("bir_1601c", "2026-08");
    assert.equal(aug.dueOn, "2026-09-10");
    assert.equal(aug.targetOn, "2026-08-28");
    assert.equal(aug.status, "behind");
    assert.equal(aug.daysLeft, -11);
    assert.equal(aug.daysToDeadline, 2);
    assert.equal(get("bir_1601c", "2026-05").status, "overdue");
    assert.equal(get("bir_1601c", "2026-10").status, "due");
    assert.equal(get("bir_1601c", "2026-09").targetOn, "2026-10-02"); // Oct 12 (rolled from Sat Oct 10) less 10 days
    assert.equal(get("sss_prn", "2026-08").status, "in_progress");
    assert.ok(!cal.some((c) => c.code === "off"), "inactive items are hidden");
  });
  it("due_soon counts down to the target, not the statutory date", () => {
    const cal = complianceCalendar(items, [], WINDOW, ctx(), "2026-08-20");
    const aug = cal.find((c) => c.code === "bir_1601c" && c.periodKey === "2026-08");
    assert.equal(aug.status, "due_soon");
    assert.equal(aug.daysLeft, 8);
  });
  it("lead days 0 makes the target the statutory date; the target never lands after it", () => {
    assert.equal(targetFor("2026-09-10", { holidays: HOLIDAYS, leadDays: 0 }), "2026-09-10");
    assert.equal(targetFor("2026-09-10", { holidays: HOLIDAYS }), "2026-08-28");
    assert.equal(targetFor("2026-12-07", { holidays: HOLIDAYS, leadDays: 10 }), "2026-11-27"); // Nov 27 is a Friday
    assert.equal(rollBack("2026-08-31", HOLIDAYS), "2026-08-28");
    const cal = complianceCalendar(items, [], WINDOW, ctx({ leadDays: 0 }), "2026-09-08");
    assert.equal(cal.find((c) => c.code === "bir_1601c" && c.periodKey === "2026-08").status, "due_soon");
  });
  it("an agency-published date overrides the rule for that period only", () => {
    const afs = item("sec_afs", { kind: "fixed", month: 4, day: 30, yearOffset: 1 }, { frequency: "annual", dueOverrides: { 2025: "2026-05-29" } });
    const d = dueDatesFor(afs, { from: "2025-01-01", to: "2026-12-31" }, ctx({ trackingFrom: "2025-01-01" }));
    assert.deepEqual(d.map((x) => [x.periodKey, x.dueOn, x.overridden]), [["2025", "2026-05-29", true], ["2026", "2027-04-30", false]]);
    assert.equal(d[0].targetOn, "2026-05-19");
  });
});

describe("report sources", () => {
  it("payroll months, year-end and DSWD point at the pages that draft them; the rest are manual", () => {
    assert.equal(reportSourceFor("bir_1601c").href("2026-08"), "/hr/reports?month=2026-08");
    assert.equal(reportSourceFor("sss_prn").href("2026-08"), "/hr/reports?month=2026-08");
    assert.equal(reportSourceFor("bir_1604c").href("2026"), "/hr/reports?year=2026");
    assert.equal(reportSourceFor("bir_2316_submit").href("2026"), "/hr/reports?year=2026");
    assert.equal(reportSourceFor("dswd_financial").href("2026"), "/compliance/dswd/2026");
    assert.equal(reportSourceFor("dswd_accomplishment").href("2025"), "/compliance/dswd/2025");
    assert.equal(reportSourceFor("sec_gis"), null);
    assert.equal(Object.keys(REPORT_SOURCES).length, 11);
  });
});

describe("payroll-derived deadlines", () => {
  it("August 2026 remittances", () => {
    const d = monthlyRemittanceDeadlines(2026, 8, ctx({ penLastDigit: 2, employerInitial: "L" }));
    assert.deepEqual(
      d.map((x) => [x.code, x.dueOn]),
      [
        ["bir_1601c", "2026-09-10"],
        ["sss_prn", "2026-09-30"],
        ["philhealth_eprs", "2026-09-15"],
        ["pagibig_mcrf", "2026-09-21"],
      ]
    );
    assert.equal(monthlyRemittanceDeadlines(2026, 12, ctx())[0].dueOn, "2027-01-15");
  });
  it("year-end", () => {
    const y = yearEndDeadlines(2026, ctx());
    assert.equal(y.find((x) => x.code === "thirteenth_month_pay").dueOn, "2026-12-24");
    assert.equal(y.find((x) => x.code === "dole_13th_report").dueOn, "2027-01-15");
    assert.equal(y.find((x) => x.code === "bir_2316").dueOn, "2027-02-01");
  });
});

describe("headcountThresholds", () => {
  it("9 is SIL-exempt, 10 is not; OSH tiers", () => {
    assert.equal(headcountThresholds(9).silExempt, true);
    assert.equal(headcountThresholds(10).silExempt, false);
    assert.equal(headcountThresholds(10).maternityDifferentialExemptEligible, true);
    assert.equal(headcountThresholds(11).maternityDifferentialExemptEligible, false);
    assert.equal(headcountThresholds(6).oshTier, "1-9");
    assert.equal(headcountThresholds(12).oshTier, "10-50");
  });
});
