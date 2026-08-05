"use client";

import { useRole } from "@/context/role-provider";
import { isNavItemVisible, NAV_ITEMS } from "@/lib/rbac/roles";

export { useRole };

export function useVisibleNavItems() {
  const { role } = useRole();
  return NAV_ITEMS.filter((item) => isNavItemVisible(item, role));
}
