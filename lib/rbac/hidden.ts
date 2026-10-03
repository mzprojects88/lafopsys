/**
 * Modules still being built, kept to the Super Admin (the `admin` role):
 * NEXT_PUBLIC_HIDDEN_ROUTES is a comma list of path prefixes ("/hr,/house-ops"),
 * set on Vercel Production only, so previews and local dev show everything to
 * everyone. For anyone but an admin a listed prefix drops out of the sidebar,
 * sub-navs, command palette and cross-links, and middleware answers 404 for it
 * and everything beneath it; admins see and use them as normal (2026-10-02 --
 * until then they were hidden from everyone). Inlined at build time: changing
 * the list takes a redeploy.
 *
 * This is visibility, not security: the data behind these pages is still
 * guarded by RLS as before (admins always have edit, shared.module_level).
 */
const ADMIN_ONLY = (process.env.NEXT_PUBLIC_HIDDEN_ROUTES ?? "")
  .split(",")
  .map((p) => p.trim().replace(/\/+$/, ""))
  .filter((p) => p.startsWith("/") && p.length > 1);

/**
 * Pages that stay open inside a hidden module, with the menu title they get there (decided
 * 2026-10-03): Finance Staff and the Office Admin post vehicle costs while the rest of Finance
 * waits for its roll-out. Who may open them still follows Roles & access and the database.
 */
export const OPEN_INSIDE_HIDDEN: readonly { href: string; title: string }[] = [{ href: "/finance/vehicle-costs", title: "Vehicle Costs" }];

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

/** On the list, whoever is looking: for the "Admin only" marks and middleware. */
export function isAdminOnlyPath(path: string): boolean {
  const bare = path.split(/[?#]/)[0];
  if (OPEN_INSIDE_HIDDEN.some((o) => under(bare, o.href))) return false;
  return ADMIN_ONLY.some((p) => under(bare, p));
}

/** The page left open inside a hidden module (for its menu entry), or null. */
export function openPageInside(moduleHref: string): { href: string; title: string } | null {
  return OPEN_INSIDE_HIDDEN.find((o) => under(o.href, moduleHref) && isAdminOnlyPath(moduleHref)) ?? null;
}

/** Hidden from this viewer: everyone but an admin. Takes the main role or all of
 * a person's roles (0073); admin is only ever a main role. */
export function isHiddenPath(path: string, role: string | readonly string[] | null | undefined): boolean {
  const isAdmin = typeof role === "string" ? role === "admin" : Boolean(role?.includes("admin"));
  return !isAdmin && isAdminOnlyPath(path);
}
