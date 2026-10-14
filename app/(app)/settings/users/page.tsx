import { Users } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/empty-state";
import { CreateStaffDialog } from "@/components/modules/settings/create-staff-dialog";
import { EditStaffAccessDialog } from "@/components/modules/settings/edit-staff-access-dialog";
import { PartnerAccountDialog } from "@/components/modules/settings/partner-account-dialog";
import { NAV_ITEMS, isPartnerRole, overridesOf, type AccessLevel, type ModuleKey, type StaffOverrideRow } from "@/lib/rbac/roles";
import { formatDate } from "@/lib/utils/date";
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
  extra_roles: Role[] | null;
  position: string;
  active: boolean;
  must_change_pin: boolean;
  hire_date: string;
  clock_in_exempt: boolean;
  landing_path: string | null;
  is_hr: boolean;
}

const NAV_TITLE: Record<string, string> = Object.fromEntries(NAV_ITEMS.map((n) => [n.href, n.title]));

interface EventRow {
  staff_id: string | null;
  action: string;
  actor_name: string;
  at: string;
}

const EVENT_LABEL: Record<string, string> = {
  created: "Created",
  access_changed: "Access changed",
  override_set: "Access adjusted",
  deactivated: "Switched off",
  reactivated: "Switched on",
  pin_reset: "PIN reset",
  deleted: "Removed",
};
const LEVEL_WORD: Record<AccessLevel, string> = { none: "none", view: "view", edit: "edit" };

export default async function UsersPage() {
  const supabase = await createClient();
  const [{ data }, { data: overrideData }, { data: eventData }, { data: roleData }, { data: hrData }] = await Promise.all([
    supabase
      .schema("shared")
      .from("staff")
      .select("id, staff_code, first_name, last_name, role, extra_roles, position, active, must_change_pin, hire_date, clock_in_exempt, landing_path, is_hr")
      .order("first_name"),
    supabase.schema("shared").from("staff_module_access").select("staff_id, module, level"),
    supabase.schema("shared").from("staff_events").select("staff_id, action, actor_name, at").order("at", { ascending: false }).limit(400),
    supabase.schema("shared").from("roles").select("key, name"),
    supabase.schema("hr").from("employees").select("staff_id, position").not("staff_id", "is", null),
  ]);
  // Role names from shared.roles (0093): created roles too.
  const roleName = (key: string) => (roleData ?? []).find((r) => r.key === key)?.name ?? ROLE_LABEL[key] ?? key;
  const hrPositionOf = new Map((hrData ?? []).map((e) => [e.staff_id as string, e.position as string]));

  const all = (data ?? []) as StaffRow[];
  const overrideRows = (overrideData ?? []) as StaffOverrideRow[];
  const lastEvent = new Map<string, EventRow>();
  for (const e of (eventData ?? []) as EventRow[]) if (e.staff_id && !lastEvent.has(e.staff_id)) lastEvent.set(e.staff_id, e);
  const overrideLine = (id: string) =>
    Object.entries(overridesOf(overrideRows, id))
      .map(([m, l]) => `${NAV_ITEMS.find((n) => n.module === (m as ModuleKey))?.title ?? m}: ${LEVEL_WORD[l as AccessLevel]}`)
      .join(" · ");
  const rows = all.filter((s) => s.active);
  const inactive = all.filter((s) => !s.active);

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Manage Users"
        description="Every account: who they are, what they can open, and whether the account is on. Creating one here creates a real login."
        action={<CreateStaffDialog />}
      />

      {all.length === 0 ? (
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
                  {isPartnerRole(s.role) && <Pill tone="info">Outside account · Inventory view only</Pill>}
                  {s.clock_in_exempt && !isPartnerRole(s.role) && <Pill tone="info">No clock-in needed</Pill>}
                  {s.is_hr && s.role !== "admin" && <Pill tone="info">Runs HR</Pill>}
                  {s.landing_path && <Pill tone="neutral">Starts on {NAV_TITLE[s.landing_path] ?? s.landing_path}</Pill>}
                </div>
                <span className="text-theme-xs text-muted-foreground">
                  {s.position} · {s.staff_code} · Hired {s.hire_date}
                  {lastEvent.get(s.id) ? ` · ${EVENT_LABEL[lastEvent.get(s.id)!.action] ?? lastEvent.get(s.id)!.action} ${formatDate(lastEvent.get(s.id)!.at, "MMM d")} by ${lastEvent.get(s.id)!.actor_name}` : ""}
                </span>
                {overrideLine(s.id) && <span className="text-theme-xs text-primary">Adjusted for this person: {overrideLine(s.id)}</span>}
              </div>
              <Pill tone="neutral" className="shrink-0">
                {[s.role, ...(s.extra_roles ?? [])].map((r) => roleName(r)).join(" + ")}
              </Pill>
              {isPartnerRole(s.role) ? (
                <PartnerAccountDialog staffId={s.id} name={`${s.first_name} ${s.last_name}`} active={s.active} />
              ) : (
              <EditStaffAccessDialog
                staffId={s.id}
                name={`${s.first_name} ${s.last_name}`}
                role={s.role}
                extraRoles={s.extra_roles ?? []}
                clockInExempt={s.clock_in_exempt}
                landingPath={s.landing_path}
                isHr={s.is_hr}
                active={s.active}
                overrides={overridesOf(overrideRows, s.id)}
                firstName={s.first_name}
                lastName={s.last_name}
                position={s.position}
                hrPosition={hrPositionOf.get(s.id) && hrPositionOf.get(s.id) !== s.position ? hrPositionOf.get(s.id) : null}
              />
              )}
            </div>
          ))}
        </div>
      )}

      {inactive.length > 0 && (
        <details className="group rounded-2xl border border-border bg-card">
          <summary className="cursor-pointer px-5 py-3 text-theme-sm font-medium text-muted-foreground">
            Switched off ({inactive.length})
          </summary>
          <div className="flex flex-col divide-y divide-border border-t border-border">
            {inactive.map((s) => (
              <div key={s.id} className="flex items-center gap-3 px-5 py-3">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-theme-sm font-medium text-foreground">
                    {s.first_name} {s.last_name}
                  </span>
                  <span className="text-theme-xs text-muted-foreground">
                    {s.position} · {s.staff_code}
                    {lastEvent.get(s.id) ? ` · ${EVENT_LABEL[lastEvent.get(s.id)!.action] ?? lastEvent.get(s.id)!.action} ${formatDate(lastEvent.get(s.id)!.at, "MMM d")} by ${lastEvent.get(s.id)!.actor_name}` : ""}
                  </span>
                </div>
                <Pill tone="neutral" className="shrink-0">
                  {[s.role, ...(s.extra_roles ?? [])].map((r) => roleName(r)).join(" + ")}
                </Pill>
                {isPartnerRole(s.role) ? (
                  <PartnerAccountDialog staffId={s.id} name={`${s.first_name} ${s.last_name}`} active={s.active} />
                ) : (
                  <EditStaffAccessDialog
                    staffId={s.id}
                    name={`${s.first_name} ${s.last_name}`}
                    role={s.role}
                    extraRoles={s.extra_roles ?? []}
                    clockInExempt={s.clock_in_exempt}
                    landingPath={s.landing_path}
                    isHr={s.is_hr}
                    active={s.active}
                    overrides={overridesOf(overrideRows, s.id)}
                firstName={s.first_name}
                lastName={s.last_name}
                position={s.position}
                hrPosition={hrPositionOf.get(s.id) && hrPositionOf.get(s.id) !== s.position ? hrPositionOf.get(s.id) : null}
                  />
                )}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function Pill({ tone, className, children }: { tone: StatusTone; className?: string; children: React.ReactNode }) {
  return <span className={cn("rounded-full px-2.5 py-0.5 text-theme-xs font-medium whitespace-nowrap", STATUS_TONE_CLASSES[tone], className)}>{children}</span>;
}
