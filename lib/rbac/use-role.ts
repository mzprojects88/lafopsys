"use client";

import { useRole } from "@/context/role-provider";
import { isNavItemVisible, NAV_ITEMS } from "@/lib/rbac/roles";
import { useModuleAccess } from "@/lib/hooks/use-module-access";

export { useRole };

export function useVisibleNavItems() {
  const { role } = useRole();
  const { rows } = useModuleAccess();
  return NAV_ITEMS.filter((item) => isNavItemVisible(item, role, rows));
}
