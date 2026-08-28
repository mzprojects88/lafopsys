import { Suspense } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { LoginForm, type LoginRosterEntry } from "@/components/modules/auth/login-form";
import { LOGIN_VISIBLE_ROLES } from "@/lib/rbac/roles";

type AdminClient = ReturnType<typeof createAdminClient>;

// Login used to reconstruct `${staffCode}@staff.lafopsys.internal` and hope
// it matched -- it only ever did for accounts created by this app. An
// account created by the sibling laf-inventory app carries a different real
// email and would fail to sign in here. Reading the actual stored email
// instead makes login work regardless of which app created the account.
async function fetchAuthEmailsById(admin: AdminClient) {
  const emailById = new Map<string, string>();
  let page = 1;
  const perPage = 200; // org-wide account count is in the dozens; loop guards against future growth
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) {
      console.error("listUsers failed while building login email map:", error.message);
      break;
    }
    for (const u of data.users) {
      if (u.email) emailById.set(u.id, u.email);
    }
    if (data.users.length < perPage) break;
    page += 1;
  }
  return emailById;
}

// A visitor on the login page has no session yet, so the RLS-gated
// `shared.staff` table isn't readable by the browser client (RLS requires
// `authenticated`). The admin (service_role) client bypasses RLS to fetch
// just the name/staff_code fields needed to populate the picker — this is a
// Server Component specifically so that privileged client never reaches the
// browser (lib/supabase/admin.ts is `server-only`).
export default async function LoginPage() {
  const supabase = createAdminClient();
  const [{ data }, emailById] = await Promise.all([
    supabase
      .schema("shared")
      .from("staff")
      .select("id, staff_code, first_name, last_name")
      .eq("active", true)
      .in("role", LOGIN_VISIBLE_ROLES)
      .order("first_name"),
    fetchAuthEmailsById(supabase),
  ]);

  const roster: LoginRosterEntry[] = (data ?? [])
    .map((s) => ({
      id: s.id,
      email: emailById.get(s.id),
      firstName: s.first_name,
      lastName: s.last_name,
    }))
    .filter((s): s is LoginRosterEntry => {
      if (!s.email) {
        console.error(`shared.staff row ${s.id} (${s.firstName} ${s.lastName}) has no matching auth.users email — hiding from login picker.`);
        return false;
      }
      return true;
    });

  return (
    <Suspense fallback={null}>
      <LoginForm roster={roster} />
    </Suspense>
  );
}
