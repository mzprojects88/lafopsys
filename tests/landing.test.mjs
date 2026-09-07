// Unit tests for lib/rbac/landing.ts -- where a person goes after signing in.
// The navigation is passed in as data so this runs without Lucide or a DOM.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isAllowedLandingPath, resolveLandingPath, ROLE_DEFAULT_LANDING } from "../lib/rbac/landing.ts";

const ALL = ["admin", "social_worker", "house_staff", "driver", "finance", "board", "volunteer"];
const INVENTORY = ["chef", "inventory_staff", "nutritionist", "inventory_lead"];

/** A nav shaped like the real one, before /executive exists. */
const NAV_BEFORE = [
  { href: "/dashboard", allowedRoles: ALL },
  { href: "/staff", allowedRoles: [...ALL, ...INVENTORY] },
  { href: "/patients", allowedRoles: ["admin", "social_worker"] },
  { href: "/finance", allowedRoles: ["admin", "finance", "board"] },
  { href: "/settings", allowedRoles: ["admin"] },
];
/** ...and after the CEO page ships. */
const NAV_AFTER = [{ href: "/executive", allowedRoles: ["admin", "board"] }, ...NAV_BEFORE];

const resolve = (input, nav = NAV_AFTER) => resolveLandingPath(input, nav);

describe("resolveLandingPath", () => {
  it("honours the person's own landing page when their role can see it", () => {
    assert.equal(resolve({ role: "admin", landingPath: "/executive", next: null }), "/executive");
  });

  it("does not strand a person on a page that has not shipped yet", () => {
    // Butch's landing_path is seeded before /executive exists; until the nav
    // entry lands he goes to the role default, never to a 404.
    assert.equal(resolve({ role: "admin", landingPath: "/executive", next: null }, NAV_BEFORE), "/dashboard");
  });

  it("ignores a landing page the role cannot open", () => {
    assert.equal(resolve({ role: "driver", landingPath: "/settings", next: null }), "/dashboard");
    assert.equal(resolve({ role: "driver", landingPath: "/finance/monthly-summary", next: null }), "/dashboard");
  });

  it("accepts a page beneath a visible nav section", () => {
    assert.equal(resolve({ role: "finance", landingPath: "/finance/monthly-summary", next: null }), "/finance/monthly-summary");
  });

  it("lets a bookmarked deep link win over everything", () => {
    assert.equal(resolve({ role: "admin", landingPath: "/executive", next: "/patients/today" }), "/patients/today");
  });

  it("treats /, /login and /dashboard in ?next= as no preference", () => {
    for (const next of ["/", "/login", "/dashboard", "", "   "]) {
      assert.equal(resolve({ role: "admin", landingPath: "/executive", next }), "/executive", `next=${JSON.stringify(next)}`);
    }
  });

  it("never follows an off-site or protocol-relative next", () => {
    assert.equal(resolve({ role: "admin", landingPath: null, next: "https://evil.example" }), "/dashboard");
    assert.equal(resolve({ role: "admin", landingPath: null, next: "//evil.example" }), "/dashboard");
  });

  it("sends inventory roles to /staff by default -- they have no Dashboard entry", () => {
    for (const role of INVENTORY) {
      assert.equal(ROLE_DEFAULT_LANDING[role], "/staff");
      assert.equal(resolve({ role, landingPath: null, next: null }), "/staff");
    }
    assert.equal(resolve({ role: "house_staff", landingPath: null, next: null }), "/dashboard");
  });
});

describe("isAllowedLandingPath", () => {
  it("requires an absolute path under a visible nav href", () => {
    assert.equal(isAllowedLandingPath("admin", "/executive", NAV_AFTER), true);
    assert.equal(isAllowedLandingPath("board", "/executive", NAV_AFTER), true);
    assert.equal(isAllowedLandingPath("finance", "/executive", NAV_AFTER), false);
    assert.equal(isAllowedLandingPath("admin", "executive", NAV_AFTER), false);
    assert.equal(isAllowedLandingPath("admin", "/executiveness", NAV_AFTER), false);
  });
});
