// lib/utils/staff-name.ts (0094) and lib/rbac/pages.ts (0093).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { nameFormat, titleFor } from "../lib/utils/staff-name.ts";
import { PAGES, pageForPath, pageLevel } from "../lib/rbac/pages.ts";
import { BUILT_IN_POWERS, holdsPower } from "../lib/rbac/who.ts";

describe("document names", () => {
  it("follows Settings, else each document's default", () => {
    assert.equal(nameFormat({}, "cash_ar"), "name_title");
    assert.equal(nameFormat({}, "manifest"), "name");
    assert.equal(nameFormat({ dtr: "name" }, "dtr"), "name");
    assert.equal(nameFormat({ dtr: "nonsense" }, "dtr"), "name_title");
    assert.equal(nameFormat(null, "payslip"), "name_title");
  });
  it("prints the title only when asked, and never an empty one", () => {
    assert.equal(titleFor("name_title", " Driver "), "Driver");
    assert.equal(titleFor("name", "Driver"), null);
    assert.equal(titleFor("name_title", "  "), null);
  });
});

describe("pages and powers (0093)", () => {
  it("the migrations seed exactly the catalogue's levelled pages", () => {
    // 0093 seeded the first pages; later pages are seeded by the migration that adds them.
    const sql = ["0093_roles_pages_powers.sql", "0095_gift_totals_and_meals_served.sql"]
      .map((f) => readFileSync(new URL(`../supabase/migrations/${f}`, import.meta.url), "utf8"))
      .join("\n");
    const seeded = [...sql.matchAll(/\('([a-z_]+\.[a-z_]+)'\)/g)].map((m) => m[1]).sort();
    assert.deepEqual(seeded, PAGES.filter((p) => !p.power).map((p) => p.key).sort());
  });
  it("a path belongs to its longest page; detail pages to their list", () => {
    assert.equal(pageForPath("/patients/floor-plan")?.key, "patients.floor_plan");
    assert.equal(pageForPath("/patients/123e4567")?.key, "patients.all");
    assert.equal(pageForPath("/hr/payroll/reconcile")?.key, "hr.management");
    assert.equal(pageForPath("/settings"), null);
  });
  it("a page's level: Super Admin edits, roles give the highest, a power opens its page, overrides win", () => {
    const page = (k) => PAGES.find((p) => p.key === k);
    const pageRows = [
      { role: "role-relief", page: "transport.trips", level: "edit" },
      { role: "role-relief", page: "patients.manifest", level: "view" },
      { role: "driver", page: "patients.manifest", level: "edit" },
    ];
    const input = { pageRows, moduleRows: [], powers: [...BUILT_IN_POWERS] };
    assert.equal(pageLevel(page("transport.trips"), "admin", input), "edit");
    assert.equal(pageLevel(page("transport.trips"), "role-relief", input), "edit");
    assert.equal(pageLevel(page("patients.manifest"), "role-relief", input), "view");
    assert.equal(pageLevel(page("patients.manifest"), ["role-relief", "driver"], input), "edit");
    assert.equal(pageLevel(page("patients.floor_plan"), "role-relief", input), "none");
    assert.equal(pageLevel(page("hr.management"), "office_admin", input), "edit");
    assert.equal(pageLevel(page("hr.management"), "driver", { ...input, isHr: true }), "edit");
    assert.equal(pageLevel(page("hr.management"), "driver", input), "none");
    assert.equal(pageLevel(page("transport.trips"), "role-relief", { ...input, overrides: { transport: "view" } }), "view");
  });
  it("powers: built-in parity, created roles by their rows", () => {
    assert.equal(holdsPower("social_worker", "bed_exception"), true);
    assert.equal(holdsPower("driver", "bed_exception"), false);
    assert.equal(holdsPower("finance", "clinical_detail"), false);
    assert.equal(holdsPower("board", "clinical_detail"), false);
    assert.equal(holdsPower("chef", "clinical_detail"), true);
    assert.equal(holdsPower("admin", "floor_plan_layout"), true);
    assert.equal(holdsPower("role-relief", "driver", [{ role: "role-relief", power: "driver" }]), true);
  });
});
