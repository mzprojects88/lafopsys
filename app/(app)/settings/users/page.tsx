import { Users } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/empty-state";
import { CreateStaffDialog } from "@/components/modules/settings/create-staff-dialog";
import { EditStaffAccessDialog } from "@/components/modules/settings/edit-staff-access-dialog";
import { NAV_ITEMS } from "@/lib/rbac/roles";
import { createClient } from "@/lib/supabase/server";
import { ROLES, type Role } from "@/lib/types/common";
import { STATUS_TONE_CLASSES, type StatusTone } from "@/lib/utils/status-colors";
import { cn } from "@/lib/utils";

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
  clock_in_exempt: boolean;
  landing_path: string | null;
  is_hr: boolean;
}

const NAV_TITLE: Record<string, string> = Object.fromEntries(NAV_ITEMS.map((n) => [n.href, n.title]));

export default async function UsersPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .schema("shared")
    .from("staff")
    .select("id, staff_code, first_name, last_name, role, position, active, must_change_pin, hire_date, clock_in_exempt, landing_path, is_hr")
    .order("first_name");

  const rows = (data ?? []) as StaffRow[];

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Users & Roles"
        description="Real staff accounts — creating one here creates a real login."
        action={<CreateStaffDialog />}
      />

      {rows.length === 0 ? (
        <EmptyState icon={Users} title="No staff accounts yet." />
      ) : (
        <div className="flex flex-col divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
          {rows.map((s) => (
            <div key={s.id} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/60">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-theme-sm font-medium text-foreground">
                    {s.first_name} {s.last_name}
                  </span>
                  {s.must_change_pin && <Pill tone="warning">Awaiting first login</Pill>}
                  {!s.active && <Pill tone="neutral">Inactive</Pill>}
                  {s.clock_in_exempt && <Pill tone="info">No clock-in needed</Pill>}
                  {s.is_hr && s.role !== "admin" && <Pill tone="info">Runs HR</Pill>}
                  {s.landing_path && <Pill tone="neutral">Starts on {NAV_TITLE[s.landing_path] ?? s.landing_path}</Pill>}
                </div>
                <span className="text-theme-xs text-muted-foreground">
                  {s.position} · {s.staff_code} · Hired {s.hire_date}
                </span>
              </div>
              <Pill tone="neutral" className="shrink-0">
                {ROLE_LABEL[s.role]}
              </Pill>
              <EditStaffAccessDialog
                staffId={s.id}
                name={`${s.first_name} ${s.last_name}`}
                role={s.role}
                clockInExempt={s.clock_in_exempt}
                landingPath={s.landing_path}
                isHr={s.is_hr}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Pill({ tone, className, children }: { tone: StatusTone; className?: string; children: React.ReactNode }) {
  return <span className={cn("rounded-full px-2.5 py-0.5 text-theme-xs font-medium whitespace-nowrap", STATUS_TONE_CLASSES[tone], className)}>{children}</span>;
}
