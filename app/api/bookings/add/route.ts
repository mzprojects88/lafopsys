import { NextResponse, after } from "next/server";
import { queueBookingEmail, readableError, requestPayload } from "@/lib/booking/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Staff file a booking for someone who phoned or walked in (0180). The request is filed in the database as the
 * signed-in person (booking.staff_request checks that they process bookings and applies the same rules as the
 * public page's door). It starts as "pending approval" like any other. When the person gave an email address,
 * the usual "we received your request" email is queued, with the Request ID.
 */
export async function POST(request: Request) {
  const raw = await request.text();
  let body: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = raw.length <= 20_000 ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
  } catch {
    body = null;
  }
  if (!body) return NextResponse.json({ ok: false, error: "That could not be read." }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Please sign in again." }, { status: 401 });

  const { data, error } = await supabase.schema("booking").rpc("staff_request", { p: requestPayload(body) });
  if (error) {
    const e = readableError(error, "staff request");
    return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
  }
  const made = data as { id: string; ref: string; seqNo: string };
  after(() => queueBookingEmail(made.id, "received"));
  return NextResponse.json({ ok: true, id: made.id, ref: made.ref, seqNo: made.seqNo });
}
