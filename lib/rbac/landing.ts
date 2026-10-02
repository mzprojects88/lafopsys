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
  // Their day is the LAF HOPE pick-ups (0053).
  driver: "/transport",
};

/** Paths that mean "no particular place" -- middleware appends ?next= for any
 * deep link, and these are the ones that are not really deep links. */
const NOWHERE = new Set(["/", "/login", "/dashboard"]);

/** One role, or all of a person's roles with the main role first (0073). */
type Who = Role | readonly Role[];
const rolesIn = (who: Who): readonly Role[] => (typeof who === "string" ? [who] : who);

function navVisible(item: LandingNavItem, who: Who): boolean {
  const allowed = item.allowedRoles;
  return allowed === "all" || rolesIn(who).some((r) => allowed.includes(r));
}

/**
 * True when `path` is a route the role can reach from its navigation -- either
 * a top-level nav href or something beneath one. A landing_path that fails
 * this is ignored rather than honoured: it protects a person from an admin's
 * typo, and from a page that has been assigned before it has shipped.
 */
export function isAllowedLandingPath(who: Who, path: string, nav: readonly LandingNavItem[]): boolean {
  if (!path.startsWith("/")) return false;
  return nav.some((item) => navVisible(item, who) && (path === item.href || path.startsWith(item.href + "/")));
}

/**
 * Precedence:
 *   1. a real deep link in ?next= -- a bookmark still works, whoever you are;
 *   2. the person's own landing_path, if their role can see it;
 *   3. the role's default, then /dashboard.
 */
export function resolveLandingPath(
  input: { role: Role | readonly Role[]; landingPath: string | null | undefined; next: string | null | undefined },
  nav: readonly LandingNavItem[]
): string {
  const next = input.next?.trim();
  if (next && next.startsWith("/") && !next.startsWith("//") && !NOWHERE.has(next)) return next;

  const own = input.landingPath?.trim();
  if (own && isAllowedLandingPath(input.role, own, nav)) return own;

  // The main role's default only if the person can open it (an admin may have set
  // the module to None, or it may be hidden on this deployment).
  const roleDefault = ROLE_DEFAULT_LANDING[rolesIn(input.role)[0]!];
  if (roleDefault && isAllowedLandingPath(input.role, roleDefault, nav)) return roleDefault;
  return DEFAULT_LANDING;
}
