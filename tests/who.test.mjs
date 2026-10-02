// Unit tests for lib/rbac/who.ts and the multi-role paths of landing.ts / hidden.ts (0073, 0074):
// a person may hold a main role plus additional roles, and may do what any of them allows.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { doesFinance, extraRoleChoices, hasAnyRole, mainRoleChoices, rolesOfRow, rolesProblem, runsHr, titleRole } from "../lib/rbac/who.ts";
import { isAllowedLandingPath, resolveLandingPath } from "../lib/rbac/landing.ts";

process.env.NEXT_PUBLIC_HIDDEN_ROUTES = "/hr";
const { isHiddenPath } = await import("../lib/rbac/hidden.ts");

describe("a person's roles", () => {
  it("reads the main role first, then the additional ones", () => {
    assert.deepEqual(rolesOfRow({ role: "inventory_lead", extra_roles: ["office_admin"] }), ["inventory_lead", "office_admin"]);
    assert.deepEqual(rolesOfRow({ role: "driver", extra_roles: null }), ["driver"]);
    assert.equal(hasAnyRole(["inventory_staff", "driver"], "driver"), true);
    assert.equal(hasAnyRole("inventory_staff", "driver"), false);
  });

  it("titles the CEO and the Office Admin by that role, whatever the main role", () => {
    assert.equal(titleRole(["admin", "ceo"]), "ceo"); // Butch: main Super Admin, shown as CEO
    assert.equal(titleRole(["inventory_lead", "office_admin"]), "office_admin"); // Desiree
    assert.equal(titleRole(["inventory_staff", "driver"]), "inventory_staff"); // Jeff
    assert.equal(titleRole("admin"), "admin");
  });

  it("lets the Super Admin, the Office Admin and is_hr people run HR -- nobody else", () => {
    assert.equal(runsHr({ role: "admin" }), true);
    assert.equal(runsHr({ role: "inventory_lead", extra_roles: ["office_admin"] }), true);
    assert.equal(runsHr({ role: "driver", is_hr: true }), true);
    assert.equal(runsHr({ role: "finance" }), false);
    assert.equal(runsHr({ role: "inventory_staff", extra_roles: ["driver"] }), false);
  });

  it("gives finance work to Finance, the Office Admin and the Super Admin", () => {
    assert.equal(doesFinance("finance"), true);
    assert.equal(doesFinance(["inventory_lead", "office_admin"]), true);
    assert.equal(doesFinance("admin"), true);
    assert.equal(doesFinance(["inventory_staff", "driver"]), false);
    assert.equal(doesFinance("board"), false);
  });
});

describe("home page and hidden modules with two roles", () => {
  const NAV = [
    { href: "/staff", allowedRoles: ["inventory_lead", "inventory_staff", "driver", "office_admin"] },
    { href: "/patients", allowedRoles: ["admin", "office_admin", "social_worker"] },
    { href: "/transport", allowedRoles: ["driver"] },
  ];
  it("allows a home page any of the person's roles can open", () => {
    assert.equal(isAllowedLandingPath(["inventory_lead", "office_admin"], "/patients", NAV), true);
    assert.equal(isAllowedLandingPath("inventory_lead", "/patients", NAV), false);
  });
  it("uses the main role's default home page", () => {
    // Jeff: main Inventory Staff (default /staff) also drives (/transport is a driver's default).
    assert.equal(resolveLandingPath({ role: ["inventory_staff", "driver"], landingPath: null, next: null }, NAV), "/staff");
    assert.equal(resolveLandingPath({ role: ["driver", "inventory_staff"], landingPath: null, next: null }, NAV), "/transport");
  });
  it("opens admin-only modules to a person whose roles include the Super Admin", () => {
    assert.equal(isHiddenPath("/hr", ["admin", "ceo"]), false);
    assert.equal(isHiddenPath("/hr", ["inventory_lead", "office_admin"]), true);
  });
});

describe("what Settings > Users offers and accepts", () => {
  it("offers the roles LAF assigns as main roles -- never CEO -- plus the one held now", () => {
    const offered = mainRoleChoices("driver");
    assert.equal(offered.includes("ceo"), false);
    assert.equal(offered.includes("board"), false);
    assert.equal(mainRoleChoices("board").includes("board"), true); // someone still holding it can be saved
  });
  it("offers CEO only beside Super Admin, and Super Admin never as an additional role", () => {
    assert.equal(extraRoleChoices("admin").includes("ceo"), true);
    assert.equal(extraRoleChoices("inventory_lead").includes("ceo"), false);
    assert.equal(extraRoleChoices("inventory_lead").includes("admin"), false);
    assert.equal(extraRoleChoices("inventory_lead").includes("inventory_lead"), false);
    assert.equal(extraRoleChoices("inventory_lead").includes("office_admin"), true);
  });
  it("refuses the combinations that would half-work", () => {
    assert.equal(rolesProblem("admin", ["ceo"]), null); // Butch
    assert.equal(rolesProblem("inventory_lead", ["office_admin"]), null); // Desiree
    assert.equal(rolesProblem("inventory_staff", ["driver"]), null); // Jeff
    assert.match(rolesProblem("ceo", []), /additional role/);
    assert.match(rolesProblem("finance", ["admin"]), /main role/);
    assert.match(rolesProblem("finance", ["ceo"]), /beside Super Admin/);
    assert.match(rolesProblem("driver", ["driver"]), /repeat/);
    assert.match(rolesProblem("driver", ["chef", "finance", "social_worker", "office_admin"]), /three/);
  });
});
