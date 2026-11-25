import "server-only";
import { createHmac } from "node:crypto";
import { sendPending } from "@/lib/notify/email";
import { createAdminClient } from "@/lib/supabase/admin";
import { supabaseServiceRoleKey } from "@/lib/supabase/env";
import { bookingEmail, type BookingEmailKind } from "@/lib/utils/booking-emails";
import { addDays, dayKey } from "@/lib/utils/dtr";
import { clientIpFromHeaders } from "@/lib/utils/device";

/**
 * The server's side of LAF Activity Center Bookings (0172). The public pages reach the database only through the
 * booking.web_* functions, run here with the service key; nobody outside holds a key to the booking tables.
 */

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The SQL states whose messages the database wrote for the person reading them (anything else is ours to hide). */
const WRITTEN_FOR_THE_READER = new Set(["22023", "53400", "42501", "P0002"]);
export function readableError(error: { code?: string; message: string }, what: string): { message: string; status: number } {
  if (error.code && WRITTEN_FOR_THE_READER.has(error.code)) return { message: error.message, status: error.code === "53400" ? 429 : 400 };
  console.error(`[booking] ${what}: ${error.code ?? ""} ${error.message}`);
  return { message: "Something went wrong on our side. Please try again in a few minutes.", status: 500 };
}

/**
 * A mark for the caller, which the public doors count by to stop one caller flooding them. A keyed hash of the
 * address: the address itself is never stored, and the mark means nothing outside this server.
 */
export function callerMark(headers: Headers): string {
  return createHmac("sha256", supabaseServiceRoleKey()).update(`booking:${clientIpFromHeaders(headers) ?? "unknown"}`).digest("hex").slice(0, 32);
}

/**
 * Queues the email that tells the requestor what happened to a booking, then sends what waits (without the email
 * key the rows wait as "held"). The routes call it once the step itself has succeeded, after the response has gone
 * out (`after`); a failure here is logged and never undoes or fails that step.
 */
export async function queueBookingEmail(requestId: string, kind: BookingEmailKind, source: string = kind): Promise<void> {
  try {
    const admin = createAdminClient();
    const db = admin.schema("booking");
    const [{ data: r }, { data: st }, { count: namesGiven }] = await Promise.all([
      db.from("requests").select("ref, requestor_name, contact_person, email, date, start_time, end_time, volunteers_count, decline_reason, instructions, place_id").eq("id", requestId).maybeSingle(),
      db.from("settings").select("reply_days, names_due_days, site_url").maybeSingle(),
      db.from("volunteers").select("id", { count: "exact", head: true }).eq("request_id", requestId),
    ]);
    if (!r || !st) return;
    const { data: place } = await db.from("places").select("name, where_to_go, instructions, coordinator_name, coordinator_phone").eq("id", r.place_id).maybeSingle();
    const { subject, html } = bookingEmail(
      kind,
      {
        ref: r.ref,
        requestorName: r.requestor_name,
        contactPerson: r.contact_person,
        date: r.date,
        start: String(r.start_time).slice(0, 5),
        end: String(r.end_time).slice(0, 5),
        placeName: place?.name ?? "",
        whereToGo: place?.where_to_go ?? "",
        volunteersCount: Number(r.volunteers_count),
        replyDays: Number(st.reply_days),
        namesDue: addDays(r.date, -Number(st.names_due_days)),
        declineReason: r.decline_reason ?? "",
        placeInstructions: place?.instructions ?? "",
        bookingInstructions: r.instructions ?? "",
        coordinatorName: place?.coordinator_name ?? "",
        coordinatorPhone: place?.coordinator_phone ?? "",
        daysToGo: daysBetween(dayKey(new Date()), r.date),
        namesGiven: namesGiven ?? 0,
      },
      st.site_url,
    );
    const { error } = await db.from("outbox").insert({ request_id: requestId, to_address: r.email, subject, body_html: html, source });
    if (error) return void console.error(`[booking] email not queued (${kind}): ${error.message}`);
    await sendPending(admin, "booking");
  } catch (e) {
    console.error(`[booking] email not queued (${kind}): ${String(e)}`);
  }
}

/** Whole days from one day to another (`yyyy-MM-dd`); negative when the second is earlier. */
export const daysBetween = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * The daily reminders: every approved booking whose visit is in 3 days or tomorrow gets one email for each, once
 * (the queue itself remembers: a reminder already written for that booking is not written again). Whatever else
 * waits in the queue is sent on the same run. Returns how many reminders were written.
 */
export async function queueBookingReminders(): Promise<{ reminders: number }> {
  const admin = createAdminClient();
  const db = admin.schema("booking");
  const today = dayKey(new Date());
  const { data: due } = await db.from("requests").select("id, date").eq("status", "approved").in("date", [addDays(today, 1), addDays(today, 3)]);
  let reminders = 0;
  for (const r of due ?? []) {
    const source = `reminder${daysBetween(today, r.date)}`;
    const { count } = await db.from("outbox").select("id", { count: "exact", head: true }).eq("request_id", r.id).eq("source", source);
    if (count) continue;
    await queueBookingEmail(r.id as string, "reminder", source);
    reminders += 1;
  }
  if (!reminders) await sendPending(admin, "booking");
  return { reminders };
}
