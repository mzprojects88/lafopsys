// lib/utils/payroll.ts -- the plan's worked examples, plus the invariants
// every payslip must satisfy: lines sum to gross, gross - deductions = net,
// to the centavo.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildSssBrackets2025, TAX_BRACKETS_2023 } from "../lib/utils/statutory.ts";
import { emptyBuckets } from "../lib/utils/attendance.ts";
import {
  computeDifferential,
  computeFinalPay,
  computePayslip,
  computeThirteenthMonth,
  coveredByMonthly,
  EMPTY_YTD,
  rates,
  registerTotals,
  separationPay,
} from "../lib/utils/payroll.ts";

const tables = {
  sss: { kind: "sss", brackets: buildSssBrackets2025() },
  philhealth: { kind: "philhealth", rate: 0.05, floor: 10000, ceiling: 100000 },
  pagibig: { kind: "pagibig", eeRateLow: 0.01, lowThreshold: 1500, eeRate: 0.02, erRate: 0.02, maxFundSalary: 10000 },
  taxSemiMonthly: { kind: "tax_semi_monthly", brackets: TAX_BRACKETS_2023.tax_semi_monthly },
  taxAnnual: { kind: "tax_annual", brackets: TAX_BRACKETS_2023.tax_annual },
};

const monthly = (basic, extra = {}) => ({ payBasis: "monthly", basicMonthly: basic, dailyRate: null, daysFactor: 365, hoursPerDay: 8, allowances: [], isMinimumWageEarner: false, ...extra });
const daily = (rate, extra = {}) => ({ payBasis: "daily", basicMonthly: null, dailyRate: rate, daysFactor: 365, hoursPerDay: 8, allowances: [], isMinimumWageEarner: false, ...extra });

const totals = (patch = {}, buckets = {}) => {
  const byPremium = emptyBuckets();
  for (const [k, v] of Object.entries(buckets)) Object.assign(byPremium[k], v);
  return { scheduledDays: 11, daysWorked: 11, absences: 0, lateMinutes: 0, undertimeMinutes: 0, paidLeaveDays: 0, unpaidLeaveDays: 0, regularHolidaysUnworked: 0, missedPunches: 0, ...patch, byPremium };
};

const base = (comp, attendance, extra = {}) =>
  computePayslip({
    period: { from: "2026-09-01", to: "2026-09-15", isSecondCutoff: false },
    comp,
    attendance,
    payItems: [],
    tables,
    minimumWageDaily: 695,
    contributionCutoff: "second",
    firstCutoff: null,
    ytd: EMPTY_YTD,
    annualise: false,
    ...extra,
  });

const second = (comp, attendance, extra = {}) => base(comp, attendance, { period: { from: "2026-09-16", to: "2026-09-30", isSecondCutoff: true }, ...extra });

const line = (p, code) => p.lines.find((l) => l.code === code);
const invariants = (p) => {
  const earn = p.lines.filter((l) => l.kind === "earning").reduce((a, l) => a + l.amount, 0);
  const ded = p.lines.filter((l) => l.kind === "deduction").reduce((a, l) => a + l.amount, 0);
  assert.equal(p.gross, earn, "gross = sum of earnings");
  assert.equal(p.net, p.gross - p.totalDeductions, "net = gross - deductions");
  assert.equal(p.totalDeductions, ded);
  assert.equal(p.taxableGross + p.nonTaxable, p.gross);
  for (const l of p.lines) assert.ok(Number.isInteger(l.amount), `${l.code} is integer centavos`);
};

describe("rates", () => {
  it("monthly 21,140 at 365 -> daily 695.01, hourly 86.88", () => {
    const r = rates(monthly(21140));
    assert.equal(r.monthly, 2114000);
    assert.equal(Math.round(r.daily), 69501);
    assert.equal(Math.round(r.hourly), 8688);
  });
  it("daily 695 -> monthly equivalent 21,139.58 at 365", () => {
    const r = rates(daily(695));
    assert.equal(r.daily, 69500);
    assert.equal(r.monthly, 2113958);
  });
  it("coverage by factor", () => {
    assert.equal(coveredByMonthly("rest_day", { payBasis: "monthly", daysFactor: 365 }), true);
    assert.equal(coveredByMonthly("rest_day", { payBasis: "monthly", daysFactor: 313 }), false);
    assert.equal(coveredByMonthly("regular_holiday", { payBasis: "monthly", daysFactor: 261 }), true);
    assert.equal(coveredByMonthly("regular_holiday", { payBasis: "daily", daysFactor: 365 }), false);
  });
});

describe("computePayslip: monthly-paid", () => {
  it("plain first cutoff: half the salary, no contributions, tax on the half", () => {
    const p = base(monthly(21140), totals());
    invariants(p);
    assert.equal(line(p, "basic").amount, 1057000);
    assert.equal(p.basicEarned, 1057000);
    assert.equal(p.statutory.sssEe, 0);
    assert.equal(p.statutory.philhealthEe, 0);
    // 10,570 semi-monthly: 15% over 10,417 = 22.95
    assert.equal(p.statutory.taxWithheld, 2295);
    assert.equal(p.net, 1057000 - 2295);
    assert.deepEqual(p.warnings, []);
  });

  it("second cutoff carries the month's contributions (cutoff = second)", () => {
    const p = second(monthly(21140), totals());
    invariants(p);
    // SSS on 21,140: MSC 21,000 -> regular EE 1,000 / ER 2,000 on the 20,000 cap, EC 30, MPF EE 50 / ER 100 on the 1,000 above it
    assert.equal(p.statutory.sssEe, 100000);
    assert.equal(p.statutory.sssEr, 200000);
    assert.equal(p.statutory.ec, 3000);
    assert.equal(p.statutory.mpfEe, 5000);
    assert.equal(p.statutory.mpfEr, 10000);
    // PhilHealth 5% of 21,140 = 1,057 -> 528.50 each
    assert.equal(p.statutory.philhealthEe, 52850);
    // Pag-IBIG 2% of 10,000 cap = 200
    assert.equal(p.statutory.pagibigEe, 20000);
    // taxable = 10,570 - (1,000 + 50 + 528.50 + 200) = 8,791.50 -> below 10,417 -> nil
    assert.equal(p.taxableIncome, 879150);
    assert.equal(p.statutory.taxWithheld, 0);
    assert.equal(p.employerTotal, 200000 + 3000 + 10000 + 52850 + 20000);
  });

  it("split cutoff: halves that sum to the month", () => {
    const a = base(monthly(21140), totals(), { contributionCutoff: "split" });
    const b = second(monthly(21140), totals(), { contributionCutoff: "split" });
    assert.equal(a.statutory.philhealthEe + b.statutory.philhealthEe, 52850);
    assert.equal(a.statutory.philhealthEe, 26425);
    assert.equal(a.statutory.sssEe + b.statutory.sssEe, 100000);
    assert.equal(a.statutory.mpfEe + b.statutory.mpfEe, 5000);
  });

  it("a regular holiday worked 8h adds one more daily rate (695.01)", () => {
    const p = base(monthly(21140), totals({}, { regular_holiday: { minutes: 480, days: 1 } }));
    invariants(p);
    const l = line(p, "premium:regular_holiday");
    assert.equal(l.amount, 69501);
    assert.equal(l.multiplier, 1);
  });

  it("rest day worked at 365 is +30%; at 313 the full 130%", () => {
    const a = base(monthly(21140), totals({}, { rest_day: { minutes: 480, days: 1 } }));
    assert.equal(line(a, "premium:rest_day").amount, Math.round(8687.671232876712 * 8 * 0.3));
    const b = base(monthly(21140, { daysFactor: 313 }), totals({}, { rest_day: { minutes: 480, days: 1 } }));
    assert.equal(line(b, "premium:rest_day").multiplier, 1.3);
  });

  it("rest-day OT hour at 86.88 -> 146.82; ordinary NSD hour -> 8.69", () => {
    const p = base(monthly(21140), totals({}, { rest_day: { minutes: 480, overtimeMinutes: 60, days: 1 }, ordinary: { nightMinutes: 60 } }));
    invariants(p);
    assert.equal(line(p, "overtime:rest_day").amount, 14682);
    assert.equal(line(p, "night:ordinary").amount, 869);
  });

  it("absence, tardiness and undertime come off as negative lines; undertime is not netted against OT", () => {
    const p = base(monthly(21140), totals({ absences: 1, lateMinutes: 12, undertimeMinutes: 30 }, { ordinary: { overtimeMinutes: 60 } }));
    invariants(p);
    assert.equal(line(p, "absence").amount, -69501);
    assert.equal(line(p, "tardiness").amount, -1738);
    assert.equal(line(p, "undertime").amount, -4344);
    assert.equal(line(p, "overtime:ordinary").amount, 10860);
    assert.equal(p.basicEarned, 1057000 - 69501 - 1738 - 4344);
  });

  it("allowances: taxable halves; de minimis exempt within the limit, excess taxable", () => {
    const comp = monthly(21140, {
      allowances: [
        { code: "comm", label: "Communication allowance", amountMonthly: 1000, tax: "taxable" },
        { code: "rice", label: "Rice subsidy", amountMonthly: 2500, tax: "de_minimis", deMinimisKind: "rice" },
      ],
    });
    const p = base(comp, totals());
    invariants(p);
    assert.equal(line(p, "allowance:comm").amount, 50000);
    assert.equal(line(p, "allowance:rice").amount, 100000);
    assert.equal(line(p, "allowance:rice:excess").amount, 25000);
    assert.equal(p.nonTaxable, 100000);
    // SSS at second cutoff is on basic + taxable allowances (1,000 + 500 excess)
    const s = second(comp, totals());
    assert.equal(s.statutory.sssEe + s.statutory.mpfEe, 112500); // 22,640 -> MSC 22,500 -> 5% = 1,125 (1,000 regular + 125 MPF)
  });

  it("pay items: a loan is capped at its balance; a retro is taxable", () => {
    const p = base(monthly(21140), totals(), {
      payItems: [
        { id: "l1", kind: "deduction", code: "sss_loan", label: "SSS salary loan", amount: 1500, remaining: 400 },
        { id: "r1", kind: "earning", code: "retro", label: "Retro pay", amount: 250.5, remaining: null },
      ],
    });
    invariants(p);
    assert.equal(line(p, "item:sss_loan").amount, 40000);
    assert.equal(line(p, "item:retro").amount, 25050);
    assert.equal(line(p, "item:retro").taxable, true);
  });

  it("minimum wage earner: no withholding, and the flag is checked against the rate", () => {
    const mwe = base(monthly(21140, { isMinimumWageEarner: true }), totals());
    assert.equal(mwe.statutory.taxWithheld, 0);
    assert.ok(line(mwe, "tax_mwe"));
    assert.deepEqual(mwe.warnings, []);
    const wrong = base(monthly(15000, { isMinimumWageEarner: true }), totals());
    assert.ok(wrong.warnings.includes("mwe_flag_mismatch"));
  });

  it("a full-time 9,000 is below minimum wage; the part-time driver at 4h/day is not", () => {
    const low = base(monthly(9000), totals());
    assert.ok(low.warnings.includes("below_minimum_wage"));
    const driver = base(monthly(10570, { hoursPerDay: 4 }), totals());
    assert.ok(!driver.warnings.includes("below_minimum_wage"));
  });

  it("no approved timesheet -> a warning, computed as a full period", () => {
    const p = base(monthly(21140), null);
    assert.ok(p.warnings.includes("no_approved_timesheet"));
    assert.equal(p.basicEarned, 1057000);
  });

  it("December annualisation refunds over-withholding", () => {
    // 20,000/month; the year's taxable income so far is under 250,000, so the annual tax is nil
    // and everything withheld during the year comes back.
    const comp = monthly(20000);
    const ytd = { ...EMPTY_YTD, taxableIncome: 200000, taxWithheld: 12000 };
    const p = second(comp, totals(), { annualise: true, ytd, period: { from: "2026-12-16", to: "2026-12-31", isSecondCutoff: true } });
    invariants(p);
    const adj = line(p, "tax_annualisation");
    assert.ok(adj, "adjustment line present");
    assert.ok(adj.amount < 0);
    assert.equal(line(p, "tax_refund").amount, 1200000);
    assert.equal(p.statutory.taxWithheld, -1200000);
    assert.equal(line(p, "tax"), undefined);
  });

  it("December annualisation withholds the shortfall", () => {
    const comp = monthly(40000);
    // 11.5 months of taxable income at ~38k net of contributions, under-withheld on purpose.
    const ytd = { ...EMPTY_YTD, taxableIncome: 437000, taxWithheld: 20000 };
    const p = second(comp, totals(), { annualise: true, ytd, period: { from: "2026-12-16", to: "2026-12-31", isSecondCutoff: true } });
    invariants(p);
    assert.ok(line(p, "tax_annualisation").amount > 0);
    assert.ok(line(p, "tax").amount > 0);
  });
});

describe("computePayslip: daily-paid", () => {
  it("695/day, 11 days of 8h -> 7,645; regular holiday worked 8h -> 1,390", () => {
    const p = base(daily(695), totals({}, { ordinary: { minutes: 5280, days: 11 }, regular_holiday: { minutes: 480, days: 1 } }));
    invariants(p);
    assert.equal(line(p, "basic").amount, 764500);
    assert.equal(line(p, "premium:regular_holiday").amount, 139000);
    assert.equal(line(p, "premium:regular_holiday").multiplier, 2);
  });
  it("unworked regular holiday is paid when eligible; contributions wait for the second cutoff on actual earnings", () => {
    const first = base(daily(695), totals({ regularHolidaysUnworked: 1 }, { ordinary: { minutes: 5280, days: 11 } }));
    assert.equal(line(first, "holiday_pay").amount, 69500);
    assert.equal(first.statutory.sssEe, 0);
    const sec = second(daily(695), totals({}, { ordinary: { minutes: 5280, days: 11 } }), { firstCutoff: { basicEarned: 8340, taxableGross: 8340 } });
    // month = 8,340 + 7,645 = 15,985 -> MSC 16,000 -> EE 800
    assert.equal(sec.statutory.sssEe, 80000);
    invariants(sec);
  });
});

describe("13th month, final pay, differential", () => {
  it("hired Jul 5 at 15,000: basic earned 88,064.52 -> 7,338.71", () => {
    const r = computeThirteenthMonth({ basicEarnedYear: 88064.52, alreadyPaid: 0, otherBenefitsYear: 0 });
    assert.equal(r.total, 733871);
    assert.equal(r.exempt, 733871);
    assert.equal(r.taxable, 0);
  });
  it("projects the cutoffs not yet paid: 8 settled cutoffs of 10,000 + 16 projected -> 20,000, with an info line", () => {
    const r = computeThirteenthMonth({ basicEarnedYear: 80000, alreadyPaid: 0, otherBenefitsYear: 0, projectedBasic: 160000, projectedCutoffs: 16 });
    assert.equal(r.total, 2000000);
    assert.equal(r.exempt, 2000000);
    const info = r.lines.find((l) => l.code === "thirteenth_month:projected");
    assert.equal(info.kind, "info");
    assert.equal(info.amount, 16000000);
    assert.match(info.label, /16 cutoffs/);
  });
  it("over the 90k ceiling the excess is taxable", () => {
    const r = computeThirteenthMonth({ basicEarnedYear: 1200000, alreadyPaid: 0, otherBenefitsYear: 5000 });
    assert.equal(r.total, 10000000);
    assert.equal(r.exempt, 8500000);
    assert.equal(r.taxable, 1500000);
  });
  it("separation pay by cause", () => {
    assert.equal(separationPay("resignation", 2000000, 3), 0);
    assert.equal(separationPay("redundancy", 2000000, 3), 6000000);
    assert.equal(separationPay("retrenchment", 2000000, 1), 2000000);
    assert.equal(separationPay("closure", 2000000, 4), 4000000);
    assert.equal(separationPay("disease", 2000000, 0.4), 2000000);
  });
  it("final pay stacks the last payslip, pro-rated 13th, VL conversion, separation pay, less accountabilities", () => {
    const last = second(monthly(21140), totals());
    const f = computeFinalPay({
      lastPayslip: last,
      thirteenth: computeThirteenthMonth({ basicEarnedYear: 150000, alreadyPaid: 0, otherBenefitsYear: 0 }),
      vlDays: 2.5,
      dailyRate: 695.01,
      monthlyRate: 21140,
      cause: "resignation",
      serviceYears: 2,
      accountabilities: 1200,
    });
    const vl = f.lines.find((l) => l.code === "vl_conversion");
    assert.equal(vl.amount, 173753);
    assert.equal(vl.taxable, false);
    assert.equal(f.lines.find((l) => l.code === "vl_conversion:excess"), undefined);
    assert.equal(f.lines.find((l) => l.code === "accountabilities").amount, 120000);
    assert.equal(f.lines.find((l) => l.code === "separation_pay"), undefined);
    assert.equal(f.net, f.gross - f.totalDeductions);
    assert.equal(f.gross, last.gross + 1250000 + 173753);
  });
  it("VL conversion is de minimis up to 10 days; the excess is taxable", () => {
    const last = second(monthly(21140), totals());
    const f = computeFinalPay({
      lastPayslip: last,
      thirteenth: computeThirteenthMonth({ basicEarnedYear: 0, alreadyPaid: 0, otherBenefitsYear: 0 }),
      vlDays: 12,
      dailyRate: 695.01,
      monthlyRate: 21140,
      cause: "resignation",
      serviceYears: 2,
      accountabilities: 0,
    });
    const exempt = f.lines.find((l) => l.code === "vl_conversion");
    const excess = f.lines.find((l) => l.code === "vl_conversion:excess");
    assert.equal(exempt.qty, 10);
    assert.equal(exempt.amount, 695010);
    assert.equal(exempt.taxable, false);
    assert.equal(excess.qty, 2);
    assert.equal(excess.amount, 139002);
    assert.equal(excess.taxable, true);
  });
  it("NCR-26 -> NCR-27 differential: only the changed lines, by the difference", () => {
    const before = base(daily(695), totals({}, { ordinary: { minutes: 5280, days: 11 } }));
    const after = base(daily(755), totals({}, { ordinary: { minutes: 5280, days: 11 } }));
    const diff = computeDifferential(before.lines, after.lines);
    const basic = diff.find((l) => l.code === "basic");
    assert.equal(basic.amount, (755 - 695) * 11 * 100);
    assert.ok(!diff.some((l) => l.code === "tax_mwe"));
  });
  it("register totals sum the slips", () => {
    const a = base(monthly(21140), totals());
    const b = base(monthly(15000), totals());
    const t = registerTotals([a, b]);
    assert.equal(t.count, 2);
    assert.equal(t.gross, a.gross + b.gross);
    assert.equal(t.net, a.net + b.net);
  });
});
