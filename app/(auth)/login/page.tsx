import { Suspense } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { LoginForm, type LoginRosterEntry } from "@/components/modules/auth/login-form";

// A visitor on the login page has no session yet, so the RLS-gated
// `shared.staff` table isn't readable by the browser client (RLS requires
// `authenticated`). The admin (service_role) client bypasses RLS to fetch
// just the name/staff_code fields needed to populate the picker — this is a
// Server Component specifically so that privileged client never reaches the
// browser (lib/supabase/admin.ts is `server-only`).
export default async function LoginPage() {
  const supabase = createAdminClient();
  const { data } = await supabase
    .schema("shared")
    .from("staff")
    .select("id, staff_code, first_name, last_name")
    .eq("active", true)
    .order("first_name");

  const roster: LoginRosterEntry[] = (data ?? []).map((s) => ({
    id: s.id,
    staffCode: s.staff_code,
    firstName: s.first_name,
    lastName: s.last_name,
  }));

  return (
    <Suspense fallback={null}>
      <LoginForm roster={roster} />
    </Suspense>
  );
}
