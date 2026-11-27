import { NextResponse, after } from "next/server";
import { welcomeGroupOnApproval } from "@/lib/booking/portal";
import { UUID, queueBookingEmail, readableError } from "@/lib/booking/server";
import { createClient } from "@/lib/supabase/server";
import type { BookingEmailKind } from "@/lib/utils/booking-emails";

export const dynamic = "force-dynamic";

/** The steps that tell the requestor something, and the email each one sends. */
const EMAIL: Record<string, BookingEmailKind | null> = { approve: "approved", decline: "declined", cancel: "cancelled", move: "moved", complete: "thanks", no_show: null };

/**
 * A staff step on a booking request (0172). The step runs in the database as the signed-in person
 * (booking.decide checks that they process bookings and that the step fits); only when it has succeeded is the
 * requestor's email queued. Going through here, an email can never be sent for a step that did not happen.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { id?: unknown; step?: unknown; payload?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id : "";
  const step = typeof body?.step === "string" ? body.step : "";
  const payload = body?.payload && typeof body.payload === "object" && !Array.isArray(body.payload) ? body.payload : {};
  if (!UUID.test(id) || !(step in EMAIL) || JSON.stringify(payload).length > 6_000) return NextResponse.json({ ok: false, error: "That step could not be read." }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Please sign in again." }, { status: 401 });

  const { error } = await supabase.schema("booking").rpc("decide", { p_id: id, p_action: step, p: payload });
  if (error) {
    const e = readableError(error, `decide ${step}`);
    return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
  }
  const kind = EMAIL[step];
  if (kind) after(() => queueBookingEmail(id, kind));
  // A group's first approved booking: its contact gets a one-time password for the Volunteers Portal (step 4).
  if (step === "approve") after(() => welcomeGroupOnApproval(id));
  return NextResponse.json({ ok: true });
}
