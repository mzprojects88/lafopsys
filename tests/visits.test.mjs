// Visits (0089): nights grouped back into visits.
import { test } from "node:test";
import assert from "node:assert/strict";
import { arrivalsOn, departuresOn, visitNights, visitOfStay, visitsOf } from "../lib/utils/visits.ts";

const night = (id, patientId, checkInAt, more = {}) => ({ id, patientId, bedPositionId: "unit-B1-A", checkInAt, status: "checked_out", checkOutAt: more.checkOutAt ?? null, checkOutReason: "daily_reset", ...more });

const stays = [
  night("n1", "p1", "2026-10-10", { visitId: "n1", checkOutAt: "2026-10-11" }),
  night("n2", "p1", "2026-10-11", { visitId: "n1", checkOutAt: "2026-10-12" }),
  night("n3", "p1", "2026-10-12", { visitId: "n1", status: "in_house", checkOutReason: undefined }),
  night("old", "p2", "2026-09-01", { visitId: undefined, checkOutAt: "2026-09-05", checkOutReason: "completed_treatment" }),
  night("n4", "p3", "2026-10-12", { visitId: "n4", status: "in_house", checkOutReason: undefined }),
  night("n5", "p4", "2026-10-11", { visitId: "n5", checkOutAt: "2026-10-12", checkOutReason: "transferred" }),
];

test("nights with one visit id are one visit; a pre-0089 stay is its own visit", () => {
  const visits = visitsOf(stays);
  assert.deepEqual(visits.map((v) => [v.id, v.stays.length, v.active]).sort(), [["n1", 3, true], ["n4", 1, true], ["n5", 1, false], ["old", 1, false]].sort());
  const v1 = visits.find((v) => v.id === "n1");
  assert.equal(v1.firstNight, "2026-10-10");
  assert.equal(v1.lastNight, "2026-10-12");
  assert.equal(visitNights(v1), 3);
  assert.equal(visitOfStay(stays[1], stays).id, "n1");
});

test("arrivals are visits that began today; departures are visits that really ended, not the morning reset", () => {
  const visits = visitsOf(stays);
  assert.deepEqual(arrivalsOn(visits, "2026-10-12").map((v) => v.id), ["n4"]);
  assert.deepEqual(departuresOn(visits, "2026-10-12").map((v) => v.id), ["n5"]);
  assert.deepEqual(departuresOn(visits, "2026-10-11").map((v) => v.id), []);
});
