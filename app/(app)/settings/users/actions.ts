"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ADMIN_ONLY_MODULES, ASSIGNABLE_ROLES, CREATABLE_ROLES, NAV_ITEMS, ORG_ROLES, isAllowedLandingPath, isPartnerRole, overridesOf, rolesProblem, type AccessLevel, type ModuleAccessRow, type ModuleKey, type StaffOverrideRow } from "@/lib/rbac/roles";
import type { Role } from "@/lib/types/common";

export interface CreateStaffInput {
  firstName: string;
  lastName: string;
  role: Role;
  position: string;
  staffCode: string;
  temporaryPin: string;
}

export interface CreateStaffResult {
  ok: boolean;
  error?: string;
}

type AccountAction = "created" | "access_changed" | "override_set" | "deactivated" | "reactivated" | "pin_reset" | "deleted";

/** The signed-in admin, or the reason they are not one. Every action here starts with it: the
 * admin client bypasses RLS, so the caller's role is checked in code. */
async function actingAdmin(): Promise<{ ok: true; id: string; name: string } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };
  const { data: me } = await supabase.schema("shared").from("staff").select("role, first_name, last_name").eq("id", user.id).single();
  if (me?.role !== "admin") return { ok: false, error: "Only admins can manage accounts." };
  return { ok: true, id: user.id, name: `${me.first_name} ${me.last_name}` };
}

/** What an admin did to an account (shared.staff_events, 0091). Never blocks the action. */
async function logAccountEvent(
  admin: ReturnType<typeof createAdminClient>,
  actor: { id: string; name: string },
  target: { id: string | null; name: string },
  action: AccountAction,
  detail: Record<string, unknown> = {}
) {
  const { error } = await admin
    .schema("shared")
    .from("staff_events")
    .insert({ staff_id: target.id, staff_name: target.name, action, detail, actor_id: actor.id, actor_name: actor.name });
  if (error) console.error("staff_events insert failed:", error.message);
}

/**
 * Creates a real staff account: a Supabase Auth user (synthesized internal
 * email + the temporary PIN as the password) plus its shared.staff row.
 * Mirrors scripts/seed-super-admin.mjs's create-then-insert-with-rollback
 * pattern, but callable from the UI and, critically, checks the CALLER's own
 * role first — the admin client bypasses RLS entirely, so that check has to
 * happen here, not be assumed from the fact that this page's nav link is
 * admin-only (nav visibility is not access control).
 */
export async function createStaffAccount(input: CreateStaffInput): Promise<CreateStaffResult> {
  const actor = await actingAdmin();
  if (!actor.ok) return actor;

  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const position = input.position.trim();
  const staffCode = input.staffCode.trim();

  if (!firstName || !lastName || !position || !staffCode) {
    return { ok: false, error: "First name, last name, position, and staff code are all required." };
  }
  if (!CREATABLE_ROLES.includes(input.role)) {
    return { ok: false, error: "Invalid role." };
  }
  if (!/^\d{6}$/.test(input.temporaryPin)) {
    return { ok: false, error: "Temporary PIN must be exactly 6 digits." };
  }

  const admin = createAdminClient();
  const email = `${staffCode.toLowerCase()}@staff.lafopsys.internal`;

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password: input.temporaryPin,
    email_confirm: true,
    user_metadata: { staffCode },
  });

  if (createError) {
    // Supabase surfaces a duplicate email as a generic 422/"already registered" —
    // translate it into something that names the actual field the admin needs to fix.
    const message = /already.*registered|already.*exists/i.test(createError.message)
      ? `Staff code "${staffCode}" is already in use.`
      : createError.message;
    return { ok: false, error: message };
  }

  const { error: insertError } = await admin.schema("shared").from("staff").insert({
    id: created.user.id,
    staff_code: staffCode,
    first_name: firstName,
    last_name: lastName,
    role: input.role,
    position,
    active: true,
    must_change_pin: true,
    // An outside account never clocks in (it cannot open this app at all).
    clock_in_exempt: isPartnerRole(input.role),
  });

  if (insertError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return { ok: false, error: `Account creation failed: ${insertError.message}` };
  }

  // laf-inventory scopes stock to a House (inventory.staff_house, 0014); an account made
  // without one sees no house stock there. One House today.
  const { error: houseError } = await admin
    .schema("inventory")
    .from("staff_house")
    .upsert({ staff_id: created.user.id, house_id: "house-laf-main" }, { onConflict: "staff_id" });
  if (houseError) {
    revalidatePath("/settings/users");
    return { ok: false, error: `The account was created, but not given a House in laf-inventory: ${houseError.message}` };
  }

  await logAccountEvent(admin, actor, { id: created.user.id, name: `${firstName} ${lastName}` }, "created", { role: input.role, position });
  revalidatePath("/settings/users");
  return { ok: true };
}

export interface UpdateStaffAccessInput {
  staffId: string;
  /** The main role: their default home page and every server check (0073). */
  role: Role;
  /** Additional roles; access is everything any role allows. Never "admin". */
  extraRoles: Role[];
  clockInExempt: boolean;
  /** A nav href the person's role can see, or null for the role default. */
  landingPath: string | null;
  /** Runs HR without being an admin (0035). Ignored for admins, who are HR anyway. */
  isHr: boolean;
  /** Off closes the account at once (0091): the database stops answering it, even mid-session. */
  active?: boolean;
  /** A new 6-digit temporary PIN, or null to leave the PIN alone (0091). */
  temporaryPin?: string | null;
}

/**
 * Sets the per-person access settings from 0031 and 0035. Same shape as
 * createStaffAccount: the caller's role is checked here because the admin
 * client bypasses RLS, and the guard trigger on shared.staff is the second
 * line of defence for anyone reaching the table another way.
 *
 * The landing path is validated against the TARGET person's role, not the
 * caller's -- an admin can see /settings, but assigning it to a driver would
 * only send them to a page they cannot use.
 */
export async function updateStaffAccess(input: UpdateStaffAccessInput): Promise<CreateStaffResult> {
  const actor = await actingAdmin();
  if (!actor.ok) return actor;
  const caller = { id: actor.id };

  const admin = createAdminClient();
  const { data: target } = await admin.schema("shared").from("staff").select("role, active, first_name, last_name, extra_roles, clock_in_exempt, landing_path, is_hr").eq("id", input.staffId).single();
  if (!target) {
    return { ok: false, error: "That staff account no longer exists." };
  }

  // An outside account has none of these settings; it is switched on and off (updatePartnerAccount).
  if (isPartnerRole(target.role) || isPartnerRole(input.role)) {
    return { ok: false, error: "An outside account has no staff access settings." };
  }

  // Roles (0073). The Super Admin is only ever a main role: every server check reads the
  // main role, so an "additional admin" would be an admin to the database and not to them.
  const extraRoles = [...new Set(input.extraRoles)];
  // A role no longer offered (house staff, board, ...) is accepted only as the one already held.
  const known = (r: Role) => ASSIGNABLE_ROLES.includes(r) || r === "ceo" || r === target.role;
  if (!ORG_ROLES.includes(input.role) || !known(input.role) || !extraRoles.every((r) => ORG_ROLES.includes(r))) {
    return { ok: false, error: "Invalid role." };
  }
  const problem = rolesProblem(input.role, extraRoles);
  if (problem) {
    return { ok: false, error: problem };
  }
  const active = input.active ?? target.active;
  if (input.staffId === caller.id && (input.role !== "admin" || !active)) {
    return { ok: false, error: input.role !== "admin" ? "You can't remove your own Super Admin role." : "You can't switch off your own account." };
  }
  // Losing an admin, by role or by switching off: someone must be left to manage the rest.
  if (target.role === "admin" && target.active && (input.role !== "admin" || !active)) {
    const { count } = await admin.schema("shared").from("staff").select("id", { count: "exact", head: true }).eq("role", "admin").eq("active", true);
    if ((count ?? 0) <= 1) {
      return { ok: false, error: "At least one active Super Admin must remain." };
    }
  }
  if (input.temporaryPin != null && !/^\d{6}$/.test(input.temporaryPin)) {
    return { ok: false, error: "Temporary PIN must be exactly 6 digits." };
  }

  const landingPath = input.landingPath?.trim() || null;
  // Against this person's own overrides too (0091): a page an override opened is a valid first page.
  const [{ data: accessRows }, { data: overrideRows }] = await Promise.all([
    admin.schema("shared").from("module_access").select("role, module, level"),
    admin.schema("shared").from("staff_module_access").select("staff_id, module, level").eq("staff_id", input.staffId),
  ]);
  const targetOverrides = overridesOf((overrideRows ?? []) as StaffOverrideRow[], input.staffId);
  if (landingPath && !isAllowedLandingPath([input.role, ...extraRoles], landingPath, (accessRows ?? []) as ModuleAccessRow[], targetOverrides)) {
    return { ok: false, error: "That page is not one this person's roles can open." };
  }

  if (input.temporaryPin != null) {
    const { error: pinError } = await admin.auth.admin.updateUserById(input.staffId, { password: input.temporaryPin });
    if (pinError) {
      return { ok: false, error: pinError.message };
    }
  }
  const { error } = await admin
    .schema("shared")
    .from("staff")
    .update({
      role: input.role,
      extra_roles: extraRoles,
      clock_in_exempt: input.clockInExempt,
      landing_path: landingPath,
      is_hr: input.isHr,
      active,
      ...(input.temporaryPin != null ? { must_change_pin: true } : {}),
    })
    .eq("id", input.staffId);

  if (error) {
    return { ok: false, error: error.message };
  }

  // The log, latest last: settings only when one of them moved, then the PIN, then on/off (the
  // Users page shows the latest line, so a switch-off is what it reads).
  const who = { id: input.staffId, name: `${target.first_name} ${target.last_name}` };
  const before = (target.extra_roles as string[] | null) ?? [];
  const settingsMoved =
    input.role !== target.role ||
    extraRoles.length !== before.length ||
    extraRoles.some((r) => !before.includes(r)) ||
    input.clockInExempt !== target.clock_in_exempt ||
    landingPath !== (target.landing_path ?? null) ||
    input.isHr !== target.is_hr;
  if (settingsMoved) {
    await logAccountEvent(admin, actor, who, "access_changed", { role: input.role, extraRoles, clockInExempt: input.clockInExempt, landingPath, isHr: input.isHr });
  }
  if (input.temporaryPin != null) await logAccountEvent(admin, actor, who, "pin_reset");
  if (active !== target.active) await logAccountEvent(admin, actor, who, active ? "reactivated" : "deactivated");

  revalidatePath("/settings/users");
  return { ok: true };
}

export interface UpdatePartnerAccountInput {
  staffId: string;
  /** Off closes the account at once: the database stops answering it, even mid-session. */
  active: boolean;
  /** A new 6-digit temporary PIN, or null to leave the PIN alone. She sets her own at sign-in. */
  temporaryPin: string | null;
}

/**
 * An outside (partner) account, 0090: switched on or off, and given a new temporary PIN. Only
 * for partner accounts -- this is not a way to deactivate staff. Admin only, checked here
 * because the admin client bypasses RLS.
 */
export async function updatePartnerAccount(input: UpdatePartnerAccountInput): Promise<CreateStaffResult> {
  const supabase = await createClient();
  const {
    data: { user: caller },
  } = await supabase.auth.getUser();
  if (!caller) {
    return { ok: false, error: "Not signed in." };
  }
  const { data: callerStaff } = await supabase.schema("shared").from("staff").select("role").eq("id", caller.id).single();
  if (callerStaff?.role !== "admin") {
    return { ok: false, error: "Only admins can change an outside account." };
  }
  if (input.temporaryPin !== null && !/^\d{6}$/.test(input.temporaryPin)) {
    return { ok: false, error: "Temporary PIN must be exactly 6 digits." };
  }

  const admin = createAdminClient();
  const { data: target } = await admin.schema("shared").from("staff").select("role").eq("id", input.staffId).single();
  if (!target || !isPartnerRole(target.role)) {
    return { ok: false, error: "That is not an outside account." };
  }

  if (input.temporaryPin !== null) {
    const { error: pinError } = await admin.auth.admin.updateUserById(input.staffId, { password: input.temporaryPin });
    if (pinError) {
      return { ok: false, error: pinError.message };
    }
  }
  const { error } = await admin
    .schema("shared")
    .from("staff")
    .update({ active: input.active, ...(input.temporaryPin !== null ? { must_change_pin: true } : {}) })
    .eq("id", input.staffId);
  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/settings/users");
  return { ok: true };
}

/** What one person may open, beyond their roles (shared.staff_module_access, 0091): `null`
 * removes the override so the roles decide again. The database refuses it for admins, outside
 * accounts and Settings; the trigger message comes back as the error. */
export async function setStaffOverride(input: { staffId: string; module: ModuleKey; level: AccessLevel | null }): Promise<CreateStaffResult> {
  const actor = await actingAdmin();
  if (!actor.ok) return actor;
  if (!NAV_ITEMS.some((n) => n.module === input.module) || ADMIN_ONLY_MODULES.includes(input.module)) {
    return { ok: false, error: "That module can't be set per person." };
  }
  const admin = createAdminClient();
  const { data: target } = await admin.schema("shared").from("staff").select("role, first_name, last_name").eq("id", input.staffId).single();
  if (!target) {
    return { ok: false, error: "That staff account no longer exists." };
  }
  // Written as the admin (not the service role) so the table's own rules and trigger apply.
  const supabase = await createClient();
  const table = supabase.schema("shared").from("staff_module_access");
  const { error } =
    input.level === null
      ? await table.delete().eq("staff_id", input.staffId).eq("module", input.module)
      : await table.upsert({ staff_id: input.staffId, module: input.module, level: input.level }, { onConflict: "staff_id,module" });
  if (error) {
    return { ok: false, error: error.message };
  }
  await logAccountEvent(admin, actor, { id: input.staffId, name: `${target.first_name} ${target.last_name}` }, "override_set", { module: input.module, level: input.level ?? "role default" });
  revalidatePath("/settings/users");
  return { ok: true };
}

/** Removes an account that was never used (shared.delete_unused_staff, 0091), then its login.
 * An account with any record is refused by the database; switch it off instead. */
export async function deleteStaffAccount(staffId: string): Promise<CreateStaffResult> {
  const actor = await actingAdmin();
  if (!actor.ok) return actor;
  const admin = createAdminClient();
  const { data: target } = await admin.schema("shared").from("staff").select("first_name, last_name, staff_code").eq("id", staffId).single();
  if (!target) {
    return { ok: false, error: "That staff account no longer exists." };
  }
  // As the admin, so the function's own checks (admin, not yourself, last admin) apply.
  const supabase = await createClient();
  const { error } = await supabase.schema("shared").rpc("delete_unused_staff", { p_staff_id: staffId });
  if (error) {
    return { ok: false, error: error.message };
  }
  const { error: authError } = await admin.auth.admin.deleteUser(staffId);
  if (authError) {
    // The staff row is gone; the login no longer reaches anything. Say so rather than hide it.
    console.error("auth user delete failed after staff delete:", authError.message);
  }
  await logAccountEvent(admin, actor, { id: null, name: `${target.first_name} ${target.last_name}` }, "deleted", { staffCode: target.staff_code });
  revalidatePath("/settings/users");
  return { ok: true };
}
