"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export interface CreateDonorPortalAccountResult {
  ok: boolean;
  error?: string;
  email?: string;
  tempPassword?: string;
}

const PASSWORD_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"; // no 0/O/1/I/l -- read aloud over the phone / typed from a screen

function generateTempPassword(length = 12) {
  const bytes = randomBytes(length);
  return Array.from(bytes, (b) => PASSWORD_CHARS[b % PASSWORD_CHARS.length]).join("");
}

/**
 * Provisions a real Supabase Auth login for an eligible donor (VIP Donors
 * Portal). Mirrors app/(app)/settings/users/actions.ts's createStaffAccount
 * exactly in shape (caller-role check -> admin client -> createUser ->
 * insert profile row -> rollback on failure), but uses the donor's own real
 * email (donors need to actually receive mail; staff use a synthesized
 * internal one) and app_metadata (not user_metadata) to mark the account as
 * a donor session -- app_metadata isn't client-writable, so middleware can
 * trust it for routing without a DB round trip.
 *
 * Eligibility is re-checked here, not just hidden in the UI, since the admin
 * client below bypasses RLS entirely.
 */
export async function createDonorPortalAccount(donorId: string): Promise<CreateDonorPortalAccountResult> {
  const supabase = await createClient();
  const {
    data: { user: caller },
  } = await supabase.auth.getUser();

  if (!caller) {
    return { ok: false, error: "Not signed in." };
  }

  const { data: callerStaff } = await supabase.schema("shared").from("staff").select("role").eq("id", caller.id).single();

  if (callerStaff?.role !== "admin" && callerStaff?.role !== "finance") {
    return { ok: false, error: "Only admins or finance staff can create donor portal accounts." };
  }

  const { data: donor } = await supabase
    .schema("ops")
    .from("donors")
    .select("id, name, type, email, gift_count")
    .eq("id", donorId)
    .single();

  if (!donor) {
    return { ok: false, error: "Donor not found." };
  }
  if (donor.type === "anonymous") {
    return { ok: false, error: "Anonymous donors can't be given a portal account." };
  }
  if (!donor.email) {
    return { ok: false, error: "This donor has no email on file." };
  }
  if (donor.gift_count < 3) {
    return { ok: false, error: "This donor has fewer than 3 recorded gifts." };
  }

  const { data: activePledge } = await supabase
    .schema("ops")
    .from("donor_pledges")
    .select("id")
    .eq("donor_id", donorId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (!activePledge) {
    return { ok: false, error: "This donor has no active recurring pledge on file." };
  }

  const { data: existingAccount } = await supabase
    .schema("shared")
    .from("donor_accounts")
    .select("id")
    .eq("donor_id", donorId)
    .maybeSingle();

  if (existingAccount) {
    return { ok: false, error: "This donor already has a portal account." };
  }

  const admin = createAdminClient();
  const tempPassword = generateTempPassword();

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: donor.email,
    password: tempPassword,
    email_confirm: true,
    app_metadata: { portal: "donor" },
  });

  if (createError) {
    const message = /already.*registered|already.*exists/i.test(createError.message)
      ? `The email "${donor.email}" is already registered to another account.`
      : createError.message;
    return { ok: false, error: message };
  }

  const { error: insertError } = await admin.schema("shared").from("donor_accounts").insert({
    id: created.user.id,
    donor_id: donorId,
    email: donor.email,
    must_change_password: true,
    status: "active",
  });

  if (insertError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return { ok: false, error: `Account creation failed: ${insertError.message}` };
  }

  revalidatePath(`/donors/${donorId}`);
  return { ok: true, email: donor.email, tempPassword };
}
