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

/** On the list, whoever is looking: for the "Admin only" marks and middleware. */
export function isAdminOnlyPath(path: string): boolean {
  const bare = path.split(/[?#]/)[0];
  return ADMIN_ONLY.some((p) => bare === p || bare.startsWith(`${p}/`));
}

/** Hidden from this viewer: everyone but an admin. Takes the main role or all of
 * a person's roles (0073); admin is only ever a main role. */
export function isHiddenPath(path: string, role: string | readonly string[] | null | undefined): boolean {
  const isAdmin = typeof role === "string" ? role === "admin" : Boolean(role?.includes("admin"));
  return !isAdmin && isAdminOnlyPath(path);
}
