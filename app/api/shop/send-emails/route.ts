import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPending } from "@/lib/notify/email";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Sends the order emails waiting in the shop's outbox (0157). Called every five minutes by the database's
 * scheduler with CALENDAR_SYNC_SECRET, and only when something waits. Nothing is read from the request: the
 * emails were written by the database when each order changed. Without the email key they wait as "held".
 */
export async function POST(request: Request) {
  const expected = process.env.CALENDAR_SYNC_SECRET;
  if (!expected) return NextResponse.json({ ok: false, error: "CALENDAR_SYNC_SECRET is not configured on the server." }, { status: 500 });
  const a = Buffer.from(request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return NextResponse.json({ ok: false, error: "Not authorised." }, { status: 401 });
  return NextResponse.json({ ok: true, ...(await sendPending(createAdminClient(), "shop")) });
}
