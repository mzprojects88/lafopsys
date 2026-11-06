import { Suspense } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { LoginForm, type LoginRosterEntry } from "@/components/modules/auth/login-form";
import pkg from "@/package.json";

// Rendered per request: the name picker reads the staff table, and without this the page was
// prerendered at build time, so an account created after the last deploy did not appear until
// the next one (found 2026-10-14; laf-inventory's login already had it).
export const dynamic = "force-dynamic";

// A visitor on the login page has no session yet, so the RLS-gated
// `shared.staff` table isn't readable by the browser client (RLS requires
// `authenticated`). The admin (service_role) client bypasses RLS to fetch
// just the names needed to populate the picker — this is a
// Server Component specifically so that privileged client never reaches the
// browser (lib/supabase/admin.ts is `server-only`).
export default async function LoginPage() {
  const supabase = createAdminClient();
  const { data } = await supabase
    .schema("shared")
    .from("staff")
    .select("id, first_name, last_name")
    .eq("active", true)
    // Every staff role, created ones too (0093); an outside account signs in to Inventory only.
    .neq("role", "partner_viewer")
    .order("first_name");

  // Names only: the email Supabase Auth signs in with stays on the server (./actions.ts).
  const roster: LoginRosterEntry[] = (data ?? []).map((s) => ({ id: s.id, firstName: s.first_name, lastName: s.last_name }));

  return (
    <Suspense fallback={null}>
      <LoginForm roster={roster} />
      {/* Which build is running (Jesse's request, 2026-10-13): the version he sets in package.json. */}
      <p className="pointer-events-none fixed inset-x-0 bottom-3 text-center text-xs text-muted-foreground">LAF Operating System v{pkg.version}</p>
    </Suspense>
  );
}
