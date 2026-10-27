import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The one door for sending email (0118): Resend's API, called directly (no SDK). Everything goes
 * through ops.outbox first; without RESEND_API_KEY on the hosting the rows wait as "held" and are
 * sent on the first run after the key is set. RESEND_FROM is the sender, e.g.
 * "Little Ark Foundation <reports@littlearkfoundation.org>" once the domain is verified in Resend.
 */
export const emailReady = () => !!process.env.RESEND_API_KEY;

export async function sendPending(admin: SupabaseClient): Promise<{ sent: number; failed: number; held: number }> {
  const ops = admin.schema("ops");
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
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from: process.env.RESEND_FROM || "Little Ark Foundation <onboarding@resend.dev>", to: [r.to_address], subject: r.subject, html: r.body_html }),
    }).catch((e: unknown) => ({ ok: false, status: 0, text: async () => String(e) }) as const);
    if (res.ok) {
      sent++;
      await ops.from("outbox").update({ status: "sent", sent_at: new Date().toISOString(), error: null }).eq("id", r.id);
    } else {
      failed++;
      await ops.from("outbox").update({ status: "failed", error: `${res.status} ${(await res.text()).slice(0, 300)}` }).eq("id", r.id);
    }
  }
  return { sent, failed, held: 0 };
}
