"use client";

import { usePathname } from "next/navigation";
import { Lock } from "lucide-react";
import { EmptyState } from "@/components/patterns/empty-state";
import { useRole } from "@/context/role-provider";
import { useModuleAccess } from "@/lib/hooks/use-module-access";
import { moduleForPath } from "@/lib/rbac/roles";
import { pageForPath } from "@/lib/rbac/pages";

/**
 * A page set to None for this person's roles (Settings -> Roles & Access) is not shown, even
 * from a typed URL (0093: per page; before, per menu). The data behind it is refused by the
 * database by the menu's level either way (0050); this keeps the page from rendering.
 * HR-flagged people reach Compliances through HR whatever their role's row. A page opened by a
 * power needs the power (0133: Financial Settings), except HR, whose page is also everyone's own HR view
 * and checks the power itself.
 */
export function ModuleGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { ready, isHr } = useRole();
  const { loading, canView, levelOfPage } = useModuleAccess();
  const moduleKey = moduleForPath(pathname);
  const page = pageForPath(pathname);

  if (!moduleKey || (moduleKey === "compliance" && isHr)) return <>{children}</>;
  if (!ready || loading) return null;
  if (page?.power === "runs_hr" || (page ? levelOfPage(page) !== "none" : canView(moduleKey))) return <>{children}</>;
  return (
    <EmptyState
      icon={Lock}
      title="You don't have access to this page"
      description="Ask an admin to open it for your role in Settings → Roles & Access."
      className="flex-1"
    />
  );
}
