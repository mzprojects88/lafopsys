"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";
import { useRole } from "@/context/role-provider";
import { levelFor, type AccessLevel, type ModuleAccessRow, type ModuleKey } from "@/lib/rbac/roles";
import type { Role } from "@/lib/types/common";

export type MutationResult = { ok: true } | { ok: false; error: string };

/** Settings -> Roles & Access (0050). The database enforces the same rows;
 * this decides what renders. */
export const moduleAccessStore = createCollection<ModuleAccessRow[]>({
  key: "shared.module_access",
  empty: [],
  tables: [{ schema: "shared", table: "module_access" }],
  fetch: async () => {
    const { data, error } = await createClient().schema("shared").from("module_access").select("role, module, level");
    if (error) throw new Error(error.message);
    return (data ?? []) as ModuleAccessRow[];
  },
});

/** The grid rows, one-shot, for code that runs before the app shell (login). */
export async function fetchModuleAccess(): Promise<ModuleAccessRow[]> {
  const { data } = await createClient().schema("shared").from("module_access").select("role, module, level");
  return (data ?? []) as ModuleAccessRow[];
}

export function useModuleAccess() {
  const { role } = useRole();
  const { data: rows, loading } = useCollection(moduleAccessStore);
  const level = React.useCallback((module: ModuleKey): AccessLevel => levelFor(rows, role, module), [rows, role]);

  async function setLevel(forRole: Role, module: ModuleKey, next: AccessLevel): Promise<MutationResult> {
    const { error } = await createClient()
      .schema("shared")
      .from("module_access")
      .upsert({ role: forRole, module, level: next }, { onConflict: "role,module" });
    if (error) return { ok: false, error: error.message };
    await moduleAccessStore.refetch();
    return { ok: true };
  }

  return {
    rows,
    loading,
    level,
    canView: (module: ModuleKey) => level(module) !== "none",
    canEdit: (module: ModuleKey) => level(module) === "edit",
    setLevel,
  };
}
