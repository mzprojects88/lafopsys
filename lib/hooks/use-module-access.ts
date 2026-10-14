"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";
import { useRole } from "@/context/role-provider";
import { levelFor, overridesOf, type AccessLevel, type ModuleAccessRow, type ModuleKey, type Overrides, type StaffOverrideRow } from "@/lib/rbac/roles";
import type { Role } from "@/lib/types/common";

export type MutationResult = { ok: true } | { ok: false; error: string };

/** What an outside (partner) account can be shown in the Inventory app (0090, laf-inventory 0063). */
export const OUTSIDE_AREAS = [
  { key: "inventory_stock", title: "Stock on hand", note: "Items, quantity on hand, unit, soonest expiry. No cost, donor or staff names." },
  { key: "inventory_given_out", title: "Given out", note: "What left the shelves, by day and purpose. No patient, carer or staff names." },
] as const;
export type OutsideArea = (typeof OUTSIDE_AREAS)[number]["key"];

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

/** One person's overrides (shared.staff_module_access, 0091): RLS hands a person their own rows
 * and an admin everyone's. */
export const staffOverridesStore = createCollection<StaffOverrideRow[]>({
  key: "shared.staff_module_access",
  empty: [],
  tables: [{ schema: "shared", table: "staff_module_access" }],
  fetch: async () => {
    const { data, error } = await createClient().schema("shared").from("staff_module_access").select("staff_id, module, level");
    if (error) throw new Error(error.message);
    return (data ?? []) as StaffOverrideRow[];
  },
});

/** The signed-in person's own overrides, one-shot, for code that runs before the app shell. */
export async function fetchMyOverrides(staffId: string): Promise<Overrides> {
  const { data } = await createClient().schema("shared").from("staff_module_access").select("staff_id, module, level").eq("staff_id", staffId);
  return overridesOf((data ?? []) as StaffOverrideRow[], staffId);
}

/** The grid rows, one-shot, for code that runs before the app shell (login). */
export async function fetchModuleAccess(): Promise<ModuleAccessRow[]> {
  const { data } = await createClient().schema("shared").from("module_access").select("role, module, level");
  return (data ?? []) as ModuleAccessRow[];
}

export function useModuleAccess() {
  // Every role the person holds counts (0073): the highest level wins, as in shared.module_level.
  const { roles, staffId } = useRole();
  const { data: rows, loading } = useCollection(moduleAccessStore);
  const { data: overrideRows } = useCollection(staffOverridesStore);
  const overrides = React.useMemo(() => overridesOf(overrideRows, staffId), [overrideRows, staffId]);
  const level = React.useCallback((module: ModuleKey): AccessLevel => levelFor(rows, roles, module, overrides), [rows, roles, overrides]);

  async function setLevel(forRole: Role, module: ModuleKey, next: AccessLevel): Promise<MutationResult> {
    const { error } = await createClient()
      .schema("shared")
      .from("module_access")
      .upsert({ role: forRole, module, level: next }, { onConflict: "role,module" });
    if (error) return { ok: false, error: error.message };
    await moduleAccessStore.refetch();
    return { ok: true };
  }

  /** An outside area for a partner role (0090): the same grid, keys the menu does not have. */
  async function setOutsideLevel(forRole: Role, area: OutsideArea, next: "none" | "view"): Promise<MutationResult> {
    const { error } = await createClient()
      .schema("shared")
      .from("module_access")
      .upsert({ role: forRole, module: area, level: next }, { onConflict: "role,module" });
    if (error) return { ok: false, error: error.message };
    await moduleAccessStore.refetch();
    return { ok: true };
  }
  /** The level a role has on an outside area, from the same rows. */
  const outsideLevel = (forRole: Role, area: OutsideArea): "none" | "view" =>
    (rows as readonly { role: string; module: string; level: string }[]).some((r) => r.role === forRole && r.module === area && r.level === "view") ? "view" : "none";

  return {
    rows,
    loading,
    /** This person's own overrides (0091). */
    overrides,
    /** Anyone's overrides, for the admin's dialog (RLS gives admins every row). */
    overridesFor: (id: string) => overridesOf(overrideRows, id),
    setOutsideLevel,
    outsideLevel,
    level,
    canView: (module: ModuleKey) => level(module) !== "none",
    canEdit: (module: ModuleKey) => level(module) === "edit",
    setLevel,
  };
}
