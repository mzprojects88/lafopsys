"use client";

import { useRole } from "@/lib/rbac/use-role";
import { ROLES, type Role } from "@/lib/types/common";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PersonAvatar } from "@/components/patterns/person-avatar";
import { Users2 } from "lucide-react";

export function RoleSwitcher() {
  const { role, setRole, user } = useRole();

  return (
    <div className="flex flex-col gap-3 group-data-[collapsible=icon]:hidden">
      <div className="flex flex-col gap-1.5 rounded-xl border bg-sidebar-accent/40 p-2.5 text-xs">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Users2 className="size-3.5" />
          <span>Viewing as (demo)</span>
        </div>
        <Select value={role} onValueChange={(v) => setRole(v as Role)}>
          <SelectTrigger size="sm" className="w-full rounded-lg bg-background">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ROLES.map((r) => (
              <SelectItem key={r.value} value={r.value}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-2.5 rounded-xl border p-2">
        <div className="relative shrink-0">
          <PersonAvatar name={user} size="sm" />
          <span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-sidebar bg-emerald-500" />
        </div>
        <span className="truncate text-sm font-medium">{user}</span>
      </div>
    </div>
  );
}
