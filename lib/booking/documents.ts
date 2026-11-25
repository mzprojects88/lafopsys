import "server-only";
import { buildActivityPlan, buildBookingDetails } from "@/lib/pdf/booking-docs";
import { textQr } from "@/lib/pdf/id-card";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PlanStatus, PublicBooking } from "@/lib/types/booking";
import { BOOKING_STATUS_LABEL, PLAN_STATUS_LABEL, REQUESTOR_KINDS, lastDayOf, participantsLabel } from "@/lib/utils/booking";
import { trackUrl } from "@/lib/utils/booking-emails";

/**
 * The printed documents of LAF Activity Center Bookings (0172), built from the database on every download.
 * Each caller first proves it may have the document (a staff session that can read the row, or the booking's own
 * Request ID); what is printed is then read here with the service key, so every copy says the same.
 */

export interface BookingDocument {
  pdf: Buffer;
  name: string;
}

/** A PDF reply shown in the browser's own viewer, from where it is printed. */
export function pdfResponse(doc: BookingDocument): Response {
  return new Response(new Uint8Array(doc.pdf), {
    headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${doc.name.replace(/[^A-Za-z0-9 .-]/g, "")}"`, "cache-control": "no-store" },
  });
}

/** The Booking Details sheet of one request: the copy for the guard at the gate. Before approval it carries no
 * instructions and no coordinator (booking.request_view gives those only once approved). */
export async function bookingDetailsPdf(requestId: string): Promise<BookingDocument | null> {
  const db = createAdminClient().schema("booking");
  const [{ data: view }, { data: row }, { data: st }] = await Promise.all([
    db.rpc("request_view", { p_id: requestId }),
    db.from("requests").select("seq_no").eq("id", requestId).maybeSingle(),
    db.from("settings").select("site_url").maybeSingle(),
  ]);
  if (!view || !row || !st) return null;
  const b = view as PublicBooking;
  const url = trackUrl(st.site_url, b.ref);
  const pdf = buildBookingDetails(
    {
      ref: b.ref,
      seqNo: row.seq_no,
      statusLabel: BOOKING_STATUS_LABEL[b.status],
      date: b.date,
      start: b.start,
      end: b.end,
      placeName: b.place.name,
      whereToGo: b.place.whereToGo,
      requestorName: b.requestorName,
      requestorKind: REQUESTOR_KINDS.find((k) => k.key === b.requestorKind)?.label ?? "",
      contactPerson: b.contactPerson,
      volunteersCount: b.volunteersCount,
      hasMinors: b.hasMinors,
      names: b.names,
      items: b.items.map((i) => ({ start: i.start, end: i.end, activity: i.activity, participants: participantsLabel(i), materials: i.materials })),
      placeInstructions: b.approved?.instructions ?? "",
      bookingInstructions: b.approved?.bookingInstructions ?? "",
      coordinatorName: b.approved?.coordinatorName ?? "",
      coordinatorPhone: b.approved?.coordinatorPhone ?? "",
      printedAt: new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date()),
      trackUrl: url,
    },
    await textQr(url),
  );
  return { pdf, name: `LAF Activity Center Booking Details ${b.ref}.pdf` };
}

/** A month's Activity Plan for a place: the copy NCH approves and signs. Every day of the month is listed; a day
 * with no activity says why when the Calendar marks it a holiday or Booking settings has it as a closed date. */
export async function activityPlanPdf(planId: string): Promise<BookingDocument | null> {
  const admin = createAdminClient();
  const db = admin.schema("booking");
  const { data: plan } = await db.from("plans").select("id, place_id, month, status, approved_on, approved_by, notes, created_by").eq("id", planId).maybeSingle();
  if (!plan) return null;
  const month = String(plan.month).slice(0, 7);
  const [first, last] = [`${month}-01`, lastDayOf(month)];
  const [{ data: items }, { data: place }, { data: holidays }, { data: closures }, { data: author }] = await Promise.all([
    db.from("plan_items").select("activity, purpose, participants, materials, on_date, start_time, end_time").eq("plan_id", planId),
    db.from("places").select("name, where_to_go").eq("id", plan.place_id).maybeSingle(),
    admin.schema("ops").from("calendar_events").select("date").eq("is_holiday", true).gte("date", first).lte("date", last),
    db.from("closures").select("place_id, date_from, date_to").lte("date_from", last).gte("date_to", first),
    plan.created_by ? admin.schema("shared").from("staff").select("first_name, last_name, position").eq("id", plan.created_by).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const dayNotes: Record<string, string> = {};
  for (const c of closures ?? []) {
    if (c.place_id && c.place_id !== plan.place_id) continue;
    for (let day = Number(first.slice(8)); day <= Number(last.slice(8)); day += 1) {
      const date = `${month}-${String(day).padStart(2, "0")}`;
      if (date >= c.date_from && date <= c.date_to) dayNotes[date] = "Closed";
    }
  }
  for (const h of holidays ?? []) dayNotes[String(h.date)] = "Holiday";
  const pdf = buildActivityPlan({
    placeName: place?.name ?? "",
    whereToGo: place?.where_to_go ?? "",
    month,
    statusLabel: PLAN_STATUS_LABEL[plan.status as PlanStatus],
    items: (items ?? []).map((i) => ({ date: i.on_date, activity: i.activity, goal: i.purpose, participants: i.participants, start: String(i.start_time ?? "").slice(0, 5), end: String(i.end_time ?? "").slice(0, 5), materials: i.materials })),
    dayNotes,
    notes: plan.notes ?? "",
    preparedBy: author ? `${author.first_name ?? ""} ${author.last_name ?? ""}`.trim() : "",
    preparedTitle: [author?.position, "Little Ark Foundation"].filter(Boolean).join(", "),
    approvedBy: plan.approved_by ?? "",
    approvedOn: plan.status === "approved" ? plan.approved_on : null,
  });
  return { pdf, name: `LAF Activity Plan ${month}.pdf` };
}
