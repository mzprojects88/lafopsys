"use client";

import { useRole } from "@/lib/rbac/use-role";
import { ROLES } from "@/lib/types/common";
import { PersonAvatar } from "@/components/patterns/person-avatar";

/**
 * Who you are signed in as, in the sidebar footer.
 *
 * This replaced a "Viewing as (demo)" role dropdown that let anyone set their
 * own role from the sidebar. It only ever changed the client's idea of the
 * role -- RLS never believed it, so the data stayed correct -- but it put
 * admin-only navigation in front of people who are not admins and then showed
 * them empty or failing pages, which reads exactly like a security hole to
 * whoever finds it. The role now comes from shared.staff and nowhere else.
 */
export function SidebarUserCard() {
  const { role, user } = useRole();
  const roleLabel = ROLES.find((r) => r.value === role)?.label ?? role;

  return (
    <div className="flex items-center gap-2.5 rounded-xl border p-2 group-data-[collapsible=icon]:hidden">
      <div className="relative shrink-0">
        <PersonAvatar name={user} size="sm" />
        <span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-sidebar bg-emerald-500" />
      </div>
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium">{user}</span>
        <span className="truncate text-xs text-muted-foreground">{roleLabel}</span>
      </div>
    </div>
  );
}
