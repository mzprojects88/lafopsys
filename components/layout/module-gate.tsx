"use client";

import { usePathname } from "next/navigation";
import { Lock } from "lucide-react";
import { EmptyState } from "@/components/patterns/empty-state";
import { useRole } from "@/context/role-provider";
import { useModuleAccess } from "@/lib/hooks/use-module-access";
import { moduleForPath } from "@/lib/rbac/roles";

/**
 * A module set to None for this role (Settings -> Roles & Access) is not
 * shown, even from a typed URL. The data behind it is refused by the
 * database either way (0050); this keeps the page from rendering empty.
 * HR-flagged people reach Compliances through HR whatever their role's row.
 */
export function ModuleGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { ready, isHr } = useRole();
  const { loading, canView } = useModuleAccess();
  const moduleKey = moduleForPath(pathname);

  if (!moduleKey || (moduleKey === "compliance" && isHr)) return <>{children}</>;
  if (!ready || loading) return null;
  if (canView(moduleKey)) return <>{children}</>;
  return (
    <EmptyState
      icon={Lock}
      title="You don't have access to this page"
      description="Ask an admin to open it for your role in Settings → Roles & Access."
      className="flex-1"
    />
  );
}
