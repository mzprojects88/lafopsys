// Unit tests for lib/utils/fuel.ts -- Fuel Monitoring's arithmetic (phase D).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  efficiencyDropped,
  estimateFuelLevel,
  gaugeTone,
  measuredKmPerLitre,
  periodRange,
  periodTotals,
  serviceDue,
  shiftPeriod,
  untrackedGaps,
} from "../lib/utils/fuel.ts";

const fill = (odometer, litres, fullTank = true, date = "2026-10-01") => ({ date, odometer, litres, fullTank });

describe("measuredKmPerLitre", () => {
  it("is km over litres between two full tanks", () => {
    const r = measuredKmPerLitre([fill(1000, 50), fill(1400, 40)]);
    assert.equal(r.kmPerLitre, 10);
    assert.equal(r.intervals.length, 1);
  });
  it("counts a top-up in between", () => {
    // 1000 full; 1200 +10 L (not full); 1500 full +40 L: 500 km on 50 L.
    assert.equal(measuredKmPerLitre([fill(1000, 50), fill(1200, 10, false), fill(1500, 40)]).kmPerLitre, 10);
  });
  it("needs two full tanks", () => {
    assert.equal(measuredKmPerLitre([fill(1000, 50)]).kmPerLitre, null);
    assert.equal(measuredKmPerLitre([fill(1000, 50, false), fill(1300, 30, false)]).kmPerLitre, null);
  });
  it("leaves out fills without an odometer", () => {
    assert.equal(measuredKmPerLitre([fill(null, 50), fill(1000, 50), fill(1400, 40)]).kmPerLitre, 10);
  });
});

describe("estimateFuelLevel", () => {
  const base = { tankLitres: 60, kmPerLitre: 10, checks: [] };
  it("is full right after a full fill", () => {
    assert.equal(estimateFuelLevel({ ...base, currentOdometer: 1000, fills: [fill(1000, 50)] }), 1);
  });
  it("drops with the km driven", () => {
    // 300 km at 10 km/L = 30 L of 60.
    assert.equal(estimateFuelLevel({ ...base, currentOdometer: 1300, fills: [fill(1000, 50)] }), 0.5);
  });
  it("starts from the driver's gauge reading when it is later", () => {
    const level = estimateFuelLevel({ ...base, currentOdometer: 1300, fills: [fill(1000, 50)], checks: [{ level: 0.25, odometer: 1300, date: "2026-10-02" }] });
    assert.equal(level, 0.25);
  });
  it("adds a top-up", () => {
    assert.equal(estimateFuelLevel({ ...base, currentOdometer: 1300, fills: [fill(1000, 50), fill(1200, 12, false)] }), 0.7);
  });
  it("adds a top-up logged without the odometer, by its day", () => {
    const fills = [fill(1000, 50, true, "2026-10-01"), fill(null, 12, false, "2026-10-02"), fill(null, 9, false, "2026-09-30")];
    assert.equal(estimateFuelLevel({ ...base, currentOdometer: 1300, fills }), 0.7);
  });
  it("needs a tank size, km per litre and a starting point", () => {
    assert.equal(estimateFuelLevel({ ...base, tankLitres: null, currentOdometer: 1000, fills: [fill(1000, 50)] }), null);
    assert.equal(estimateFuelLevel({ ...base, currentOdometer: 1000, fills: [] }), null);
  });
  it("never goes below empty", () => {
    assert.equal(estimateFuelLevel({ ...base, currentOdometer: 9000, fills: [fill(1000, 50)] }), 0);
  });
});

describe("gaugeTone", () => {
  it("is red under a quarter, amber under half", () => {
    assert.equal(gaugeTone(0.2), "destructive");
    assert.equal(gaugeTone(0.4), "warning");
    assert.equal(gaugeTone(0.5), "success");
  });
});

describe("periods", () => {
  it("weeks run Monday to Sunday", () => {
    assert.deepEqual(periodRange("week", "2026-10-02"), { from: "2026-09-28", to: "2026-10-04", label: "Sep 28 – Oct 4, 2026" });
    assert.equal(periodRange("week", "2026-10-04").from, "2026-09-28"); // a Sunday
  });
  it("months, quarters and years", () => {
    assert.deepEqual(periodRange("month", "2026-02-14"), { from: "2026-02-01", to: "2026-02-28", label: "February 2026" });
    assert.deepEqual(periodRange("quarter", "2026-11-03"), { from: "2026-10-01", to: "2026-12-31", label: "Q4 2026 (Oct–Dec)" });
    assert.deepEqual(periodRange("year", "2026-11-03"), { from: "2026-01-01", to: "2026-12-31", label: "2026" });
  });
  it("steps back and forward", () => {
    assert.equal(shiftPeriod("month", "2026-01-31", 1), "2026-02-01");
    assert.equal(periodRange("month", shiftPeriod("month", "2026-01-31", 1)).label, "February 2026");
    assert.equal(shiftPeriod("quarter", "2026-11-03", -1).slice(0, 7), "2026-08");
    assert.equal(shiftPeriod("day", "2026-12-31", 1), "2027-01-01");
  });
});

describe("periodTotals", () => {
  const trips = [
    { date: "2026-10-01", status: "completed", odometerStart: 1000, odometerEnd: 1030 },
    { date: "2026-10-01", status: "completed", odometerStart: 1030, odometerEnd: 1050 },
    { date: "2026-10-02", status: "in_progress", odometerStart: 1050, odometerEnd: null },
  ];
  const expenses = [
    { date: "2026-10-01", kind: "fuel", amount: 3000, litres: 50, paidBy: "laf" },
    { date: "2026-10-02", kind: "change_oil", amount: 2500, litres: null, paidBy: "driver" },
  ];
  it("adds up the period", () => {
    const t = periodTotals(trips, expenses, 10);
    assert.equal(t.trips, 2);
    assert.equal(t.km, 50);
    assert.equal(t.litresBought, 50);
    assert.equal(t.fuelCost, 3000);
    assert.equal(t.otherCost, 2500);
    assert.equal(t.totalCost, 5500);
    assert.equal(t.estLitresUsed, 5);
    assert.equal(t.costPerKm, 110);
    assert.equal(t.paidByDrivers, 2500);
    assert.deepEqual(t.byKind, { fuel: 3000, change_oil: 2500 });
  });
  it("has no cost per km without km", () => {
    assert.equal(periodTotals([], expenses, 10).costPerKm, null);
  });
});

describe("untrackedGaps", () => {
  it("finds km driven between trips", () => {
    const gaps = untrackedGaps([
      { id: "a", date: "2026-10-01", departedAt: "1", odometerStart: 1000, odometerEnd: 1030 },
      { id: "b", date: "2026-10-01", departedAt: "2", odometerStart: 1031, odometerEnd: 1050 }, // 1 km: the yard
      { id: "c", date: "2026-10-02", departedAt: "3", odometerStart: 1080, odometerEnd: 1100 },
    ]);
    assert.deepEqual(gaps, [{ afterTripId: "b", date: "2026-10-02", km: 30 }]);
  });
});

describe("efficiencyDropped", () => {
  const iv = (kmPerLitre) => ({ to: "x", km: kmPerLitre * 10, litres: 10, kmPerLitre });
  it("flags a fill well below the ones before", () => {
    assert.equal(efficiencyDropped([iv(10), iv(10), iv(10), iv(7.5)], 20), true);
    assert.equal(efficiencyDropped([iv(10), iv(10), iv(10), iv(9)], 20), false);
  });
  it("needs history first", () => {
    assert.equal(efficiencyDropped([iv(10), iv(5)], 20), false);
  });
});

describe("serviceDue", () => {
  const rule = { everyKm: 5000, everyMonths: 6 };
  const last = { date: "2026-04-15", odometer: 100000 };
  it("is fine well before", () => {
    assert.deepEqual(serviceDue(rule, last, { day: "2026-06-01", odometer: 101000 }), { status: "ok", kmLeft: 4000, daysLeft: 136 });
  });
  it("is soon in the last 500 km or two weeks", () => {
    assert.equal(serviceDue(rule, last, { day: "2026-06-01", odometer: 104600 }).status, "soon");
    assert.equal(serviceDue(rule, last, { day: "2026-10-05", odometer: 101000 }).status, "soon");
  });
  it("is overdue by km or by months, whichever comes first", () => {
    assert.equal(serviceDue(rule, last, { day: "2026-06-01", odometer: 105100 }).status, "overdue");
    assert.equal(serviceDue(rule, last, { day: "2026-10-20", odometer: 101000 }).status, "overdue");
  });
  it("months land on the same day, or the month's last", () => {
    assert.equal(serviceDue({ everyKm: null, everyMonths: 1 }, { date: "2026-01-31", odometer: null }, { day: "2026-02-28", odometer: null }).daysLeft, 0);
  });
  it("can't tell without a last service", () => {
    assert.equal(serviceDue(rule, null, { day: "2026-06-01", odometer: 1 }).status, "unknown");
  });
});
