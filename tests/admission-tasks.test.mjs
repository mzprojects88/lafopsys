// Unit tests for lib/utils/admission-tasks.ts -- the arrival-day list a stay
// needs: everything the first time, the shorter set for a returning family.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isFirstStay, orientationProgress } from "../lib/utils/admission-tasks.ts";

const stay = (id, patientId, checkInAt) => ({ id, patientId, checkInAt, bedPositionId: "b", status: "in_house" });
const topics = [
  { id: "t1", topic: "House rules", sortOrder: 1, returneeToo: true },
  { id: "t2", topic: "Meal times", sortOrder: 2, returneeToo: true },
  { id: "t3", topic: "The full tour", sortOrder: 3, returneeToo: false },
];

describe("orientationProgress", () => {
  const first = stay("s1", "p1", "2026-09-01");
  const second = stay("s2", "p1", "2026-09-20");

  it("a first stay takes every topic", () => {
    const p = orientationProgress(first, [first], topics, []);
    assert.deepEqual(p, { done: 0, total: 3, firstStay: true });
  });

  it("a returning family takes the shorter list", () => {
    const p = orientationProgress(second, [first, second], topics, [{ stayId: "s2", topicId: "t1", coveredAt: "" }]);
    assert.deepEqual(p, { done: 1, total: 2, firstStay: false });
  });

  it("another stay's ticks do not count", () => {
    const p = orientationProgress(second, [first, second], topics, [{ stayId: "s1", topicId: "t1", coveredAt: "" }]);
    assert.equal(p.done, 0);
  });

  it("another patient's earlier stay does not make this a return", () => {
    assert.equal(isFirstStay(first, [first, stay("s9", "p2", "2026-01-01")]), true);
  });
});
