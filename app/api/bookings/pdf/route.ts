import { NextResponse } from "next/server";
import { activityPlanPdf, bookingDetailsPdf, pdfResponse } from "@/lib/booking/documents";
import { UUID } from "@/lib/booking/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * A booking document for staff (0172): `?kind=details&id=<request>` is the Booking Details sheet for the guard,
 * `?kind=plan&id=<plan>` the month's Activity Plan for NCH. The caller must be able to read the row with their
 * own session (the database shows bookings only to those who may open the Bookings pages).
 */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const kind = q.get("kind");
  const id = q.get("id") ?? "";
  if ((kind !== "details" && kind !== "plan") || !UUID.test(id)) return NextResponse.json({ error: "That document was not found." }, { status: 404 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const { data: mine } = await supabase.schema("booking").from(kind === "plan" ? "plans" : "requests").select("id").eq("id", id).maybeSingle();
  if (!mine) return NextResponse.json({ error: "That document was not found." }, { status: 404 });

  const doc = kind === "plan" ? await activityPlanPdf(id) : await bookingDetailsPdf(id);
  return doc ? pdfResponse(doc) : NextResponse.json({ error: "That document was not found." }, { status: 404 });
}
