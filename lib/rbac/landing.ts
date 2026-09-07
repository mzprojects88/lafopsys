import type { Role } from "@/lib/types/common";

/**
 * Where a person goes after signing in.
 *
 * Pure and icon-free on purpose: lib/rbac/roles.ts carries the Lucide icons
 * for the sidebar, which makes it awkward to load under `node --test`. This
 * module takes the navigation as plain data so the rules can be tested
 * without a DOM, and roles.ts binds it to the real NAV_ITEMS.
 */

export interface LandingNavItem {
  href: string;
  allowedRoles: readonly Role[] | "all";
}

export const DEFAULT_LANDING = "/dashboard";

/** Where each role lands when the person has no landing_path of their own.
 * The four inventory roles have no Dashboard entry in the nav, so sending
 * them there gives a page with nothing on it; /staff is where their clock is. */
export const ROLE_DEFAULT_LANDING: Partial<Record<Role, string>> = {
  chef: "/staff",
  inventory_staff: "/staff",
  inventory_lead: "/staff",
  nutritionist: "/staff",
};

/** Paths that mean "no particular place" -- middleware appends ?next= for any
 * deep link, and these are the ones that are not really deep links. */
const NOWHERE = new Set(["/", "/login", "/dashboard"]);

function navVisible(item: LandingNavItem, role: Role): boolean {
  return item.allowedRoles === "all" || item.allowedRoles.includes(role);
}

/**
 * True when `path` is a route the role can reach from its navigation -- either
 * a top-level nav href or something beneath one. A landing_path that fails
 * this is ignored rather than honoured: it protects a person from an admin's
 * typo, and from a page that has been assigned before it has shipped.
 */
export function isAllowedLandingPath(role: Role, path: string, nav: readonly LandingNavItem[]): boolean {
  if (!path.startsWith("/")) return false;
  return nav.some((item) => navVisible(item, role) && (path === item.href || path.startsWith(item.href + "/")));
}

/**
 * Precedence:
 *   1. a real deep link in ?next= -- a bookmark still works, whoever you are;
 *   2. the person's own landing_path, if their role can see it;
 *   3. the role's default, then /dashboard.
 */
export function resolveLandingPath(
  input: { role: Role; landingPath: string | null | undefined; next: string | null | undefined },
  nav: readonly LandingNavItem[]
): string {
  const next = input.next?.trim();
  if (next && next.startsWith("/") && !next.startsWith("//") && !NOWHERE.has(next)) return next;

  const own = input.landingPath?.trim();
  if (own && isAllowedLandingPath(input.role, own, nav)) return own;

  return ROLE_DEFAULT_LANDING[input.role] ?? DEFAULT_LANDING;
}
