// lib/rbac/access.ts (0091): the role grid plus one person's overrides, as shared.module_level() has it.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { levelFor, overridesOf } from "../lib/rbac/access.ts";

const grid = [
  { role: "driver", module: "transport", level: "edit" },
  { role: "driver", module: "house_ops", level: "view" },
  { role: "finance", module: "finance", level: "edit" },
  { role: "board", module: "finance", level: "view" },
];

describe("levelFor", () => {
  it("reads the roles as before when there is no override", () => {
    assert.equal(levelFor(grid, "driver", "transport"), "edit");
    assert.equal(levelFor(grid, "driver", "patients"), "none");
    assert.equal(levelFor(grid, ["board", "finance"], "finance"), "edit"); // the highest of their roles
    assert.equal(levelFor(grid, "admin", "patients"), "edit");
    assert.equal(levelFor(grid, "finance", "settings"), "none");
  });

  it("lets the person's own override raise or lower one module and nothing else", () => {
    const own = overridesOf(
      [
        { staff_id: "me", module: "patients", level: "view" },
        { staff_id: "me", module: "transport", level: "none" },
        { staff_id: "someone-else", module: "finance", level: "edit" },
      ],
      "me"
    );
    assert.deepEqual(own, { patients: "view", transport: "none" });
    assert.equal(levelFor(grid, "driver", "patients", own), "view");
    assert.equal(levelFor(grid, "driver", "transport", own), "none");
    assert.equal(levelFor(grid, "driver", "house_ops", own), "view");
    assert.equal(levelFor(grid, "driver", "finance", own), "none");
  });

  it("never lowers an admin and never opens Settings", () => {
    assert.equal(levelFor(grid, "admin", "patients", { patients: "none" }), "edit");
    assert.equal(levelFor(grid, "driver", "settings", { settings: "edit" }), "none");
    assert.deepEqual(overridesOf([], "me"), {});
  });
});
