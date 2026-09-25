"use client";

import * as React from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/patterns/page-header";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useModuleAccess } from "@/lib/hooks/use-module-access";
import { useRole } from "@/context/role-provider";
import { isHiddenPath } from "@/lib/rbac/hidden";
import { NAV_ITEMS, ORG_ROLES, levelFor, type AccessLevel, type NavItem } from "@/lib/rbac/roles";
import { ROLES, type Role } from "@/lib/types/common";

const ROLE_LABEL: Record<Role, string> = Object.fromEntries(ROLES.map((r) => [r.value, r.label])) as Record<Role, string>;
const LEVEL_LABEL: Record<AccessLevel, string> = { none: "None", view: "View only", edit: "Edit" };
const CONFIGURABLE = ORG_ROLES.filter((r) => r !== "admin");

/**
 * Settings -> Roles & Access (0050): for each main menu and role, whether the
 * role sees it and whether it may change things there. The database enforces
 * every cell; admins are always full and Settings stays with them.
 */
export default function AccessPage() {
  const { role } = useRole();
  const { rows, loading, setLevel } = useModuleAccess();
  const [busy, setBusy] = React.useState<string | null>(null);

  async function change(forRole: Role, item: NavItem, next: AccessLevel) {
    const key = `${forRole}|${item.module}`;
    setBusy(key);
    const result = await setLevel(forRole, item.module, next);
    setBusy(null);
    if (!result.ok) {
      toast.error(`Couldn't save: ${result.error}`);
      return;
    }
    toast.success(`${ROLE_LABEL[forRole]} · ${item.title}: ${LEVEL_LABEL[next]}`);
  }

  if (role !== "admin") return null;

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Roles & Access"
        description="What each role sees in the menu, and whether it can change things there or only look. Changes apply at once, in the menu and in the database."
      />

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] border-collapse text-theme-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="sticky left-0 z-10 h-11 w-64 bg-card px-5 text-theme-xs font-medium text-muted-foreground">Module</th>
                <th className="h-11 px-3 text-theme-xs font-medium text-muted-foreground">{ROLE_LABEL.admin}</th>
                {CONFIGURABLE.map((r) => (
                  <th key={r} className="h-11 px-3 text-theme-xs font-medium text-muted-foreground">
                    {ROLE_LABEL[r]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {NAV_ITEMS.map((item) => (
                <tr key={item.module} className="border-b border-border last:border-0">
                  <td className="sticky left-0 z-10 bg-card px-5 py-3 align-top">
                    <div className="flex flex-col gap-0.5">
                      <span className="flex flex-wrap items-center gap-1.5 font-medium text-foreground">
                        {item.title}
                        {isHiddenPath(item.href) && (
                          <Badge variant="secondary">
                            Hidden on this site
                          </Badge>
                        )}
                      </span>
                      {item.note && <span className="text-theme-xs text-muted-foreground">{item.note}</span>}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-theme-xs text-muted-foreground">Full</td>
                  {CONFIGURABLE.map((r) => {
                    if (item.adminOnly) {
                      return (
                        <td key={r} className="px-3 py-3 text-theme-xs text-muted-foreground">
                          —
                        </td>
                      );
                    }
                    const level = levelFor(rows, r, item.module);
                    const options: AccessLevel[] = item.viewOnly ? ["none", "view"] : ["none", "view", "edit"];
                    return (
                      <td key={r} className="px-3 py-3">
                        <Select
                          value={level}
                          disabled={loading || busy === `${r}|${item.module}`}
                          onValueChange={(v) => change(r, item, v as AccessLevel)}
                        >
                          <SelectTrigger
                            size="sm"
                            className="w-[104px]"
                            aria-label={`${item.title} for ${ROLE_LABEL[r]}`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {options.map((o) => (
                              <SelectItem key={o} value={o}>
                                {LEVEL_LABEL[o]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-theme-xs text-muted-foreground">
        Patient names and stays are readable to anyone with Patients <em>or</em> House Operations, since trips and meals need them.
        Running HR follows the HR flag on each person in Users &amp; Roles. Stock is changed in the LAF Inventory app, which keeps
        its own roles.
      </p>
    </div>
  );
}
