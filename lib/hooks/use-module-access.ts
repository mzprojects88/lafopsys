"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";
import { useRole } from "@/context/role-provider";
import { levelFor, overridesOf, setRolePowers, type AccessLevel, type ModuleAccessRow, type ModuleKey, type Overrides, type RolePowerRow, type StaffOverrideRow } from "@/lib/rbac/roles";
import { PAGES, pageForPath, pageLevel, type PageDef, type Power, type RolePageRow } from "@/lib/rbac/pages";
import { ROLES, type Role } from "@/lib/types/common";

export type MutationResult = { ok: true } | { ok: false; error: string };

/** What an outside (partner) account can be shown in the Inventory app (0090, laf-inventory 0063). */
export const OUTSIDE_AREAS = [
  { key: "inventory_stock", title: "Stock on hand", note: "Items, quantity on hand, unit, soonest expiry. No cost, donor or staff names." },
  { key: "inventory_given_out", title: "Given out", note: "What left the shelves, by day and purpose. No patient, carer or staff names." },
] as const;
export type OutsideArea = (typeof OUTSIDE_AREAS)[number]["key"];

/** Settings -> Roles & Access (0050). The database enforces the same rows;
 * this decides what renders. The menu levels follow the page levels (0093). */
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

/** A level per page per role (shared.role_page_access, 0093). Empty before 0093: the menus decide. */
export const rolePagesStore = createCollection<RolePageRow[]>({
  key: "shared.role_page_access",
  empty: [],
  tables: [{ schema: "shared", table: "role_page_access" }],
  fetch: async () => {
    const { data, error } = await createClient().schema("shared").from("role_page_access").select("role, page, level");
    if (error) return []; // before 0093
    return (data ?? []) as RolePageRow[];
  },
});

/** What each role may do beyond its pages (shared.role_powers, 0093). The helpers in lib/rbac read
 * the same rows; until they load (or before 0093) today's built-in powers apply. */
export const rolePowersStore = createCollection<RolePowerRow[]>({
  key: "shared.role_powers",
  empty: [],
  tables: [{ schema: "shared", table: "role_powers" }],
  fetch: async () => {
    const { data, error } = await createClient().schema("shared").from("role_powers").select("role, power");
    if (error) {
      setRolePowers(null);
      return [];
    }
    setRolePowers(data as RolePowerRow[]);
    return (data ?? []) as RolePowerRow[];
  },
});

/** Every role, built-in or created (shared.roles, 0093). */
export interface RoleRow {
  key: string;
  name: string;
  description: string | null;
  built_in: boolean;
  archived_at: string | null;
}
export const rolesStore = createCollection<RoleRow[]>({
  key: "shared.roles",
  empty: [],
  tables: [{ schema: "shared", table: "roles" }],
  fetch: async () => {
    const { data, error } = await createClient().schema("shared").from("roles").select("key, name, description, built_in, archived_at").order("name");
    if (error) return [];
    return (data ?? []) as RoleRow[];
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
  const { roles, staffId, isHr } = useRole();
  const pathname = usePathname();
  const { data: rows, loading } = useCollection(moduleAccessStore);
  const { data: pageRows } = useCollection(rolePagesStore);
  const { data: powers } = useCollection(rolePowersStore);
  const { data: overrideRows } = useCollection(staffOverridesStore);
  const overrides = React.useMemo(() => overridesOf(overrideRows, staffId), [overrideRows, staffId]);
  const level = React.useCallback((module: ModuleKey): AccessLevel => levelFor(rows, roles, module, overrides), [rows, roles, overrides]);
  const levelOfPage = React.useCallback(
    (page: PageDef): AccessLevel => pageLevel(page, roles, { pageRows, moduleRows: rows, powers, overrides, isHr }),
    [pageRows, rows, powers, overrides, roles, isHr]
  );
  /** The level on a path's page, or on its menu when the path is not a catalogued page. */
  const levelOfPath = React.useCallback(
    (path: string, module?: ModuleKey): AccessLevel => {
      const page = pageForPath(path);
      return page ? levelOfPage(page) : module ? level(module) : "none";
    },
    [levelOfPage, level]
  );
  // On a page of this menu, "may I change things here" is that page's level (0093); elsewhere, the menu's.
  const here = pageForPath(pathname);
  const effective = (module: ModuleKey): AccessLevel => (here && here.module === module ? levelOfPage(here) : level(module));

  async function setLevel(forRole: Role, module: ModuleKey, next: AccessLevel): Promise<MutationResult> {
    const { error } = await createClient()
      .schema("shared")
      .from("module_access")
      .upsert({ role: forRole, module, level: next }, { onConflict: "role,module" });
    if (error) return { ok: false, error: error.message };
    await moduleAccessStore.refetch();
    return { ok: true };
  }

  /** A role's level on one page (0093): None removes the row; the menu level follows in the database. */
  async function setPageLevel(forRole: Role, pageKeys: readonly string[], next: AccessLevel): Promise<MutationResult> {
    const table = createClient().schema("shared").from("role_page_access");
    const { error } =
      next === "none"
        ? await table.delete().eq("role", forRole).in("page", [...pageKeys])
        : await table.upsert(pageKeys.map((page) => ({ role: forRole, page, level: next })), { onConflict: "role,page" });
    if (error) return { ok: false, error: error.message };
    await Promise.all([rolePagesStore.refetch(), moduleAccessStore.refetch()]);
    return { ok: true };
  }

  /** A power on a role (0093). */
  async function setPower(forRole: Role, power: Power, on: boolean): Promise<MutationResult> {
    const table = createClient().schema("shared").from("role_powers");
    // Insert-or-nothing: the table grants insert and delete only (a power is on or off, never edited).
    const { error } = on
      ? await table.upsert({ role: forRole, power }, { onConflict: "role,power", ignoreDuplicates: true })
      : await table.delete().eq("role", forRole).eq("power", power);
    if (error) return { ok: false, error: error.message };
    await rolePowersStore.refetch();
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
    pageRows,
    powers,
    loading,
    /** This person's own overrides (0091). */
    overrides,
    /** Anyone's overrides, for the admin's dialog (RLS gives admins every row). */
    overridesFor: (id: string) => overridesOf(overrideRows, id),
    setOutsideLevel,
    outsideLevel,
    level,
    levelOfPage,
    levelOfPath,
    /** The first page of a menu this person can open, for the menu link. */
    firstPageOf: (module: ModuleKey) => PAGES.find((p) => p.module === module && levelOfPage(p) !== "none") ?? null,
    canView: (module: ModuleKey) => effective(module) !== "none",
    canEdit: (module: ModuleKey) => effective(module) === "edit",
    setLevel,
    setPageLevel,
    setPower,
  };
}

/** Role names from shared.roles (0093), falling back to the built-in labels; the live roles an
 * admin created (offered in pickers). */
export function useRoleNames() {
  const { data } = useCollection(rolesStore);
  const name = React.useCallback(
    (key: string) => data.find((r) => r.key === key)?.name ?? ROLES.find((r) => r.value === key)?.label ?? key,
    [data]
  );
  const custom = React.useMemo(() => data.filter((r) => !r.built_in && !r.archived_at).map((r) => r.key as Role), [data]);
  return { roles: data, name, custom };
}
