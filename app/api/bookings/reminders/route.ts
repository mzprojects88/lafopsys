import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { queueBookingReminders } from "@/lib/booking/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The daily booking reminders (0178): called once a day by the database's scheduler with CALENDAR_SYNC_SECRET,
 * like the Shop's email job. Each approved booking whose visit is in 3 days or tomorrow gets its reminder once;
 * emails that were waiting are sent on the same run. Nothing is read from the request. Without the email key the
 * reminders wait as "held" like every other email.
 */
export async function POST(request: Request) {
  const expected = process.env.CALENDAR_SYNC_SECRET;
  if (!expected) return NextResponse.json({ ok: false, error: "CALENDAR_SYNC_SECRET is not configured on the server." }, { status: 500 });
  const a = Buffer.from(request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return NextResponse.json({ ok: false, error: "Not authorised." }, { status: 401 });
  return NextResponse.json({ ok: true, ...(await queueBookingReminders()) });
}
