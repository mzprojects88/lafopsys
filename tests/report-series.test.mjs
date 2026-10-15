// lib/utils/report-series.ts: buckets, sums and patient filters behind Analytics.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ageGroupOn, autoGrain, breakdown, bucketsBetween, matchesPatient, series } from "../lib/utils/report-series.ts";

describe("buckets", () => {
  it("chooses day, week or month by the range", () => {
    assert.equal(autoGrain("2026-10-01", "2026-10-31"), "day");
    assert.equal(autoGrain("2026-08-01", "2026-10-31"), "week");
    assert.equal(autoGrain("2026-01-01", "2026-12-31"), "month");
  });
  it("covers the range with no gaps, weeks from Monday, months across a year end", () => {
    assert.deepEqual(bucketsBetween("2026-10-14", "2026-10-16", "day"), ["2026-10-14", "2026-10-15", "2026-10-16"]);
    assert.deepEqual(bucketsBetween("2026-10-15", "2026-10-27", "week"), ["2026-10-12", "2026-10-19", "2026-10-26"]);
    assert.deepEqual(bucketsBetween("2026-11-20", "2027-01-05", "month"), ["2026-11-01", "2026-12-01", "2027-01-01"]);
  });
});

describe("series and breakdown", () => {
  const rows = [
    { day: "2026-10-14", n: 2 },
    { day: "2026-10-14", n: 1 },
    { day: "2026-10-16", n: 5 },
    { day: "2026-09-30", n: 9 },
  ];
  it("sums per bucket, keeps empty days, leaves out days outside the range", () => {
    const s = series(rows, (r) => r.day, { from: "2026-10-14", to: "2026-10-16", grain: "day" }, { count: () => 1, total: (r) => r.n });
    assert.deepEqual(s.map((b) => [b.label, b.count, b.total]), [["Oct 14", 2, 3], ["Oct 15", 0, 0], ["Oct 16", 1, 5]]);
  });
  it("counts values largest first, blanks as Not recorded, the tail as Other", () => {
    const b = breakdown(["A", "B", "A", null, "C", "A", "B"], (x) => x, 2);
    assert.deepEqual(b, [{ name: "A", count: 3 }, { name: "B", count: 2 }, { name: "Other", count: 2 }]);
  });
});

describe("patient filters", () => {
  const p = { priority: "A", illnessCode: "C", diagnosisIds: ["d-all"], status: "ongoing", sex: "F", birthDate: "2020-03-01", provinceId: "p1", referringHospitalId: "nch" };
  const ctx = { categoryOf: (id) => (id === "d-all" ? "cancer" : undefined), today: "2026-10-15" };
  it("passes with no filter and with matching filters", () => {
    assert.equal(matchesPatient(p, {}, ctx), true);
    assert.equal(matchesPatient(p, { priority: "A", illnessCode: "C", diagnosisCategory: "cancer", sex: "F", ageGroup: "6–9", hospitalId: "nch" }, ctx), true);
  });
  it("fails any filter that doesn't match", () => {
    assert.equal(matchesPatient(p, { priority: "B" }, ctx), false);
    assert.equal(matchesPatient(p, { diagnosisCategory: "thalassemia" }, ctx), false);
    assert.equal(matchesPatient(p, { ageGroup: "2–5" }, ctx), false);
  });
  it("age group on a day", () => {
    assert.equal(ageGroupOn("2020-10-16", "2026-10-15"), "2–5");
    assert.equal(ageGroupOn("2020-10-15", "2026-10-15"), "6–9");
  });
});
