// Unit tests for lib/rbac/hidden.ts -- modules still being built are the
// Super Admin's only (2026-10-02): an admin sees them, everyone else doesn't.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// The list is read when the module loads (Vercel inlines it at build time).
process.env.NEXT_PUBLIC_HIDDEN_ROUTES = "/hr,/donors/,/patients/referrals";
const { isAdminOnlyPath, isHiddenPath } = await import("../lib/rbac/hidden.ts");

describe("admin-only modules", () => {
  it("lists a prefix and everything beneath it, not look-alikes", () => {
    assert.equal(isAdminOnlyPath("/hr"), true);
    assert.equal(isAdminOnlyPath("/hr/payroll?run=1"), true);
    assert.equal(isAdminOnlyPath("/donors"), true); // a trailing slash in the list is ignored
    assert.equal(isAdminOnlyPath("/hrx"), false);
    assert.equal(isAdminOnlyPath("/patients"), false);
    assert.equal(isAdminOnlyPath("/patients/referrals/new"), true);
  });

  it("is open to the admin and hidden from every other role", () => {
    assert.equal(isHiddenPath("/hr/leave", "admin"), false);
    for (const role of ["finance", "social_worker", "inventory_lead", "board", undefined, null]) {
      assert.equal(isHiddenPath("/hr/leave", role), true, `hidden from ${role}`);
    }
    assert.equal(isHiddenPath("/patients", "finance"), false);
  });
});
