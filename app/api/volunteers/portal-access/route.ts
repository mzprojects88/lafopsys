import { NextResponse } from "next/server";
import { UUID, readableError } from "@/lib/booking/server";
import { makeOtp, otpHash } from "@/lib/booking/portal-crypto";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const reply = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

/**
 * Staff give a group portal access, or lock or unlock it (0182). The step runs in the database as the signed-in
 * person (booking.portal_issue / portal_lock check that they keep volunteers). For "issue", the one-time password
 * is made here, only its hash goes to the database, and the password itself is returned once, to be passed on.
 * It is never logged or stored.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { groupId?: unknown; action?: unknown } | null;
  const groupId = typeof body?.groupId === "string" ? body.groupId : "";
  const action = body?.action;
  if (!UUID.test(groupId) || (action !== "issue" && action !== "lock" && action !== "unlock")) return reply({ ok: false, error: "That could not be read." }, 400);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return reply({ ok: false, error: "Please sign in again." }, 401);
  const booking = supabase.schema("booking");

  if (action === "issue") {
    const otp = makeOtp();
    const { data, error } = await booking.rpc("portal_issue", { p_group: groupId, p_otp_hash: otpHash(otp) });
    if (error) {
      const e = readableError(error, "portal issue");
      return reply({ ok: false, error: e.message }, e.status);
    }
    const { data: st } = await booking.from("settings").select("site_url").maybeSingle();
    const site = String(st?.site_url ?? "").replace(/\/+$/, "") || new URL(request.url).origin;
    return reply({ ok: true, otp, email: (data as { email: string }).email, expiresAt: (data as { expiresAt: string }).expiresAt, signInUrl: `${site}/book/sign-in` });
  }
  const { error } = await booking.rpc("portal_lock", { p_group: groupId, p_locked: action === "lock" });
  if (error) {
    const e = readableError(error, "portal lock");
    return reply({ ok: false, error: e.message }, e.status);
  }
  return reply({ ok: true });
}
