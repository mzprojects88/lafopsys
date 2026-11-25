import { NextResponse } from "next/server";
import { bookingDetailsPdf, pdfResponse } from "@/lib/booking/documents";
import { callerMark, readableError } from "@/lib/booking/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const no = (message: string, status: number) => NextResponse.json({ ok: false, error: message }, { status, headers: { "cache-control": "no-store" } });

/**
 * The Booking Details sheet for a group, by its Request ID (0172): the copy the volunteers print and hand to the
 * guard at the gate. Only an approved booking has one. The look-up is the same counted door as the booking page's
 * (booking.web_lookup), so guessing Request IDs here is stopped the same way.
 */
export async function GET(request: Request) {
  const ref = (new URL(request.url).searchParams.get("ref") ?? "").slice(0, 40);
  const db = createAdminClient().schema("booking");
  const { data, error } = await db.rpc("web_lookup", { p_ref: ref, p_caller: callerMark(request.headers) });
  if (error) {
    const e = readableError(error, "details sheet");
    return no(e.message, e.status);
  }
  const view = data as { ref: string; status: string } | null;
  if (!view) return no("No booking has that Request ID. Please check it and try again.", 404);
  if (view.status !== "approved" && view.status !== "completed") return no("The Booking Details sheet is ready once the booking is approved.", 400);
  const { data: row } = await db.from("requests").select("id").eq("ref", view.ref).maybeSingle();
  const doc = row ? await bookingDetailsPdf(row.id as string) : null;
  return doc ? pdfResponse(doc) : no("No booking has that Request ID. Please check it and try again.", 404);
}
