"use client";

import { useRole } from "@/context/role-provider";
import { visibleNavItems } from "@/lib/rbac/roles";
import { useModuleAccess } from "@/lib/hooks/use-module-access";

export { useRole };

export function useVisibleNavItems() {
  const { roles } = useRole();
  const { rows, overrides, levelOfPath, firstPageOf } = useModuleAccess();
  // A menu whose first page is None for this person opens at the first page they can (0093).
  return visibleNavItems(roles, rows, overrides).map((item) => {
    const start = item.startsAt ?? item.href;
    if (levelOfPath(start, item.module) !== "none") return item;
    const first = firstPageOf(item.module);
    return first ? { ...item, href: first.path, startsAt: undefined } : item;
  });
}
