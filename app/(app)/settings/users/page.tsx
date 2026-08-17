import { PageHeader } from "@/components/patterns/page-header";
import { CreateStaffDialog } from "@/components/modules/settings/create-staff-dialog";
import { createClient } from "@/lib/supabase/server";
import { ROLES, type Role } from "@/lib/types/common";

const ROLE_LABEL: Record<Role, string> = Object.fromEntries(ROLES.map((r) => [r.value, r.label])) as Record<Role, string>;

interface StaffRow {
  id: string;
  staff_code: string;
  first_name: string;
  last_name: string;
  role: Role;
  position: string;
  active: boolean;
  must_change_pin: boolean;
  hire_date: string;
}

export default async function UsersPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .schema("shared")
    .from("staff")
    .select("id, staff_code, first_name, last_name, role, position, active, must_change_pin, hire_date")
    .order("first_name");

  const rows = (data ?? []) as StaffRow[];

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Users & Roles"
        description="Real staff accounts — creating one here creates a real login."
        action={<CreateStaffDialog />}
      />

      <div className="flex flex-col gap-2">
        {rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">No staff accounts yet.</p>
        ) : (
          rows.map((s) => (
            <div key={s.id} className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3">
              <div className="flex flex-1 flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">
                    {s.first_name} {s.last_name}
                  </span>
                  {s.must_change_pin && (
                    <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                      Awaiting first login
                    </span>
                  )}
                  {!s.active && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">Inactive</span>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">
                  {s.position} · {s.staff_code} · Hired {s.hire_date}
                </span>
              </div>
              <span className="shrink-0 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground">
                {ROLE_LABEL[s.role]}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
