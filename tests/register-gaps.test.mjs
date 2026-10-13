import { test } from "node:test";
import assert from "node:assert/strict";
import { registerGaps } from "../lib/utils/register-gaps.ts";

test("a complete series has no gaps; a missing number is counted per series", () => {
  assert.deepEqual(registerGaps(["LAF-CSH-2026-0001", "LAF-CSH-2026-0002", "DC-2026-0001"]), []);
  assert.deepEqual(registerGaps(["LAF-CSH-2026-0001", "LAF-CSH-2026-0003", "DC-2026-0004", "AR-2026-123456"]), [
    { series: "LAF-CSH-2026", missing: 1 },
    { series: "DC-2026", missing: 3 },
  ]);
  assert.deepEqual(registerGaps([]), []);
});
