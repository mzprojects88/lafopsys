/**
 * Modules still being built, hidden from one deployment: NEXT_PUBLIC_HIDDEN_ROUTES
 * is a comma list of path prefixes ("/hr,/house-ops"), set on Vercel Production
 * only, so previews and local dev keep showing everything. A hidden prefix
 * drops out of the sidebar, sub-navs, command palette and cross-links, and
 * middleware answers 404 for it and everything beneath it. Inlined at build
 * time: changing the list takes a redeploy.
 *
 * This is visibility, not security: the data behind a hidden page is still
 * guarded by RLS as before.
 */
const HIDDEN = (process.env.NEXT_PUBLIC_HIDDEN_ROUTES ?? "")
  .split(",")
  .map((p) => p.trim().replace(/\/+$/, ""))
  .filter((p) => p.startsWith("/") && p.length > 1);

export function isHiddenPath(path: string): boolean {
  const bare = path.split(/[?#]/)[0];
  return HIDDEN.some((p) => bare === p || bare.startsWith(`${p}/`));
}
