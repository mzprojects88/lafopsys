// The order rule for adding or changing punches (0146): a change may not make a new problem.
import { it } from "node:test";
import assert from "node:assert/strict";
import { orderBroken, pairSessions } from "../lib/utils/dtr.ts";

// Manila is UTC+8: "2026-11-10T00:00:00Z" is 8:00 AM there.
const P = (id, type, at, staffId = "s1") => ({ id, staffId, punchType: type, punchedAt: at });
const day = [P("i1", "clock_in", "2026-11-10T00:00:00Z"), P("o1", "clock_out", "2026-11-10T09:00:00Z")];

it("accepts a clock-out moved within its session, and a missing one added", () => {
  assert.equal(orderBroken(day, [day[0], P("o1", "clock_out", "2026-11-10T08:30:00Z")]), null);
  assert.equal(orderBroken([day[0]], day), null);
});

it("refuses an OUT before its IN, a second IN that day, two OUTs, and a session over 25 hours", () => {
  assert.ok(orderBroken(day, [day[0], P("o1", "clock_out", "2026-11-09T23:00:00Z")]));
  assert.ok(orderBroken(day, [...day, P("i2", "clock_in", "2026-11-10T05:00:00Z")]));
  assert.ok(orderBroken(day, [...day, P("o2", "clock_out", "2026-11-10T10:00:00Z")]));
  assert.ok(orderBroken([day[0]], [day[0], P("o1", "clock_out", "2026-11-11T02:00:00Z")]));
});

it("judges only the problems a change makes, and each person apart", () => {
  const old = [P("a", "clock_out", "2026-11-09T09:00:00Z"), ...day]; // an old orphan OUT stays as it was
  assert.equal(orderBroken(old, [old[0], day[0], P("o1", "clock_out", "2026-11-10T08:00:00Z")]), null);
  assert.equal(orderBroken(day, [...day, P("x", "clock_in", "2026-11-10T01:00:00Z", "s2")]), null);
});

it("gives a session the id of its clock-out", () => {
  assert.equal(pairSessions(day)[0].clockOutId, "o1");
});

it("refuses a move or add that takes an IN and its OUT apart", () => {
  // Mon 8:00-17:00, Tue 8:00 still open: Monday's OUT moved to Tue 9:00 would close Tuesday instead.
  const week = [P("m1", "clock_in", "2026-11-09T00:00:00Z"), P("m2", "clock_out", "2026-11-09T09:00:00Z"), P("t1", "clock_in", "2026-11-10T00:00:00Z")];
  assert.ok(orderBroken(week, [week[0], P("m2", "clock_out", "2026-11-10T01:00:00Z"), week[2]]));
  // Overnight Mon 20:00 to Tue 6:00: an IN put at Tue 1:00 would steal the OUT.
  const night = [P("n1", "clock_in", "2026-11-09T12:00:00Z"), P("n2", "clock_out", "2026-11-09T22:00:00Z")];
  assert.ok(orderBroken(night, [...night, P("x", "clock_in", "2026-11-09T17:00:00Z")]));
});
