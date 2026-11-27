import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The one door for sending email (0118): Resend's API, called directly (no SDK). Everything goes
 * through ops.outbox first; without RESEND_API_KEY on the hosting the rows wait as "held" and are
 * sent on the first run after the key is set. RESEND_FROM is the sender, e.g.
 * "Little Ark Foundation <reports@littlearkfoundation.org>" once the domain is verified in Resend.
 *
 * The shop keeps its own outbox (shop.outbox, 0157) in the same shape: ops is carried between development and
 * production every hour, and a test order's email must never be sent from production. `schema` picks the outbox.
 * LAF Activity Center Bookings has its own too (booking.outbox, 0172), for the same reason.
 */
export const emailReady = () => !!process.env.RESEND_API_KEY;

/** One email through Resend: the sender and the reply-to (RESEND_REPLY_TO, info@) from the hosting. */
async function resendPost(to: string, subject: string, html: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: "no email key" };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ from: process.env.RESEND_FROM || "Little Ark Foundation <onboarding@resend.dev>", ...(process.env.RESEND_REPLY_TO ? { reply_to: process.env.RESEND_REPLY_TO } : {}), to: [to], subject, html }),
  }).catch((e: unknown) => ({ ok: false, status: 0, text: async () => String(e) }) as const);
  return res.ok ? { ok: true } : { ok: false, error: `${res.status} ${(await res.text()).slice(0, 300)}` };
}

/**
 * Sends one email now and keeps no copy: for a one-time password, which must never wait in an outbox that staff can
 * read. A failure is returned, not retried.
 */
export const sendNow = (to: string, subject: string, html: string) => resendPost(to, subject, html);

export async function sendPending(admin: SupabaseClient, schema: "ops" | "shop" | "booking" = "ops"): Promise<{ sent: number; failed: number; held: number }> {
  const ops = admin.schema(schema);
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    const { data } = await ops.from("outbox").update({ status: "held" }).eq("status", "queued").select("id");
    const { count } = await ops.from("outbox").select("id", { count: "exact", head: true }).eq("status", "held");
    return { sent: 0, failed: 0, held: count ?? data?.length ?? 0 };
  }
  const { data: rows } = await ops.from("outbox").select("id, to_address, subject, body_html").in("status", ["queued", "held"]).order("created_at").limit(50);
  let sent = 0;
  let failed = 0;
  for (const r of rows ?? []) {
    const res = await resendPost(r.to_address, r.subject, r.body_html);
    if (res.ok) {
      sent++;
      await ops.from("outbox").update({ status: "sent", sent_at: new Date().toISOString(), error: null }).eq("id", r.id);
    } else {
      failed++;
      await ops.from("outbox").update({ status: "failed", error: res.error }).eq("id", r.id);
    }
  }
  return { sent, failed, held: 0 };
}
