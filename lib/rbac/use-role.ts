"use client";

import { useRole } from "@/context/role-provider";
import { visibleNavItems } from "@/lib/rbac/roles";
import { useModuleAccess } from "@/lib/hooks/use-module-access";

export { useRole };

export function useVisibleNavItems() {
  const { roles } = useRole();
  const { rows } = useModuleAccess();
  return visibleNavItems(roles, rows);
}
