"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ORG_ROLES, isAllowedLandingPath } from "@/lib/rbac/roles";
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
  const supabase = await createClient();
  const {
    data: { user: caller },
  } = await supabase.auth.getUser();

  if (!caller) {
    return { ok: false, error: "Not signed in." };
  }

  const { data: callerStaff } = await supabase.schema("shared").from("staff").select("role").eq("id", caller.id).single();

  if (callerStaff?.role !== "admin") {
    return { ok: false, error: "Only admins can create staff accounts." };
  }

  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const position = input.position.trim();
  const staffCode = input.staffCode.trim();

  if (!firstName || !lastName || !position || !staffCode) {
    return { ok: false, error: "First name, last name, position, and staff code are all required." };
  }
  if (!ORG_ROLES.includes(input.role)) {
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
  });

  if (insertError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return { ok: false, error: `Account creation failed: ${insertError.message}` };
  }

  revalidatePath("/settings/users");
  return { ok: true };
}

export interface UpdateStaffAccessInput {
  staffId: string;
  clockInExempt: boolean;
  /** A nav href the person's role can see, or null for the role default. */
  landingPath: string | null;
}

/**
 * Sets the two per-person access settings from 0031. Same shape as
 * createStaffAccount: the caller's role is checked here because the admin
 * client bypasses RLS, and the guard trigger on shared.staff is the second
 * line of defence for anyone reaching the table another way.
 *
 * The landing path is validated against the TARGET person's role, not the
 * caller's -- an admin can see /settings, but assigning it to a driver would
 * only send them to a page they cannot use.
 */
export async function updateStaffAccess(input: UpdateStaffAccessInput): Promise<CreateStaffResult> {
  const supabase = await createClient();
  const {
    data: { user: caller },
  } = await supabase.auth.getUser();

  if (!caller) {
    return { ok: false, error: "Not signed in." };
  }

  const { data: callerStaff } = await supabase.schema("shared").from("staff").select("role").eq("id", caller.id).single();
  if (callerStaff?.role !== "admin") {
    return { ok: false, error: "Only admins can change access settings." };
  }

  const admin = createAdminClient();
  const { data: target } = await admin.schema("shared").from("staff").select("role").eq("id", input.staffId).single();
  if (!target) {
    return { ok: false, error: "That staff account no longer exists." };
  }

  const landingPath = input.landingPath?.trim() || null;
  if (landingPath && !isAllowedLandingPath(target.role as Role, landingPath)) {
    return { ok: false, error: "That page is not one this person's role can open." };
  }

  const { error } = await admin
    .schema("shared")
    .from("staff")
    .update({ clock_in_exempt: input.clockInExempt, landing_path: landingPath })
    .eq("id", input.staffId);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/settings/users");
  return { ok: true };
}
