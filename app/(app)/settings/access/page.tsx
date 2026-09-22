"use client";

import * as React from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/patterns/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[1100px] border-collapse text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left">
                <th className="sticky left-0 z-10 w-64 bg-muted/40 px-3 py-2 font-medium">Module</th>
                <th className="px-2 py-2 font-medium">{ROLE_LABEL.admin}</th>
                {CONFIGURABLE.map((r) => (
                  <th key={r} className="px-2 py-2 font-medium">
                    {ROLE_LABEL[r]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {NAV_ITEMS.map((item) => (
                <tr key={item.module} className="border-b last:border-0">
                  <td className="sticky left-0 z-10 bg-card px-3 py-2 align-top">
                    <div className="flex flex-col gap-0.5">
                      <span className="flex flex-wrap items-center gap-1.5 font-medium">
                        {item.title}
                        {isHiddenPath(item.href) && (
                          <Badge variant="secondary" className="text-[10px]">
                            Hidden on this site
                          </Badge>
                        )}
                      </span>
                      {item.note && <span className="text-xs text-muted-foreground">{item.note}</span>}
                    </div>
                  </td>
                  <td className="px-2 py-2 text-xs text-muted-foreground">Full</td>
                  {CONFIGURABLE.map((r) => {
                    if (item.adminOnly) {
                      return (
                        <td key={r} className="px-2 py-2 text-xs text-muted-foreground">
                          —
                        </td>
                      );
                    }
                    const level = levelFor(rows, r, item.module);
                    const options: AccessLevel[] = item.viewOnly ? ["none", "view"] : ["none", "view", "edit"];
                    return (
                      <td key={r} className="px-2 py-2">
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
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Patient names and stays are readable to anyone with Patients <em>or</em> House Operations, since trips and meals need them.
        Running HR follows the HR flag on each person in Users &amp; Roles. Stock is changed in the LAF Inventory app, which keeps
        its own roles.
      </p>
    </div>
  );
}
