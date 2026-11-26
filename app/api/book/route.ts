import { NextResponse, after } from "next/server";
import { UUID, callerMark, queueBookingEmail, queueStaffAlert, readableError, requestPayload } from "@/lib/booking/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * The public booking page's one door to the server (0172). No sign-in: anyone may see which slots are open, file a
 * request, and open a booking with its Request ID. Every rule is the database's (booking.web_*), which also counts
 * the calls of each caller; this route only shapes what goes in, hides what is not for the reader, and queues the
 * email after a step succeeded. Nothing here answers with a name, an email address or a number of another group.
 */

const text = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");
const no = (message: string, status = 400) => NextResponse.json({ ok: false, error: message }, { status, headers: { "cache-control": "no-store" } });
const yes = (data: Record<string, unknown>) => NextResponse.json({ ok: true, ...data }, { headers: { "cache-control": "no-store" } });
const booking = () => createAdminClient().schema("booking");

/** A month of one place: each slot and its state, never a name. Briefly cached: the database judges again on sending. */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const place = q.get("place") ?? "";
  const month = q.get("month") ?? "";
  if (!UUID.test(place) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return no("Choose a place and a month.");
  const { data, error } = await booking().rpc("web_availability", { p_place: place, p_month: `${month}-01` });
  if (error) {
    const e = readableError(error, "availability");
    return no(e.message, e.status);
  }
  return NextResponse.json({ ok: true, slots: data ?? [] }, { headers: { "cache-control": "public, s-maxage=20, max-age=0" } });
}

type Json = Record<string, unknown>;

export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > 20_000) return no("That is too much to send.", 413);
  let b: Json;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    b = parsed as Json;
  } catch {
    return no("That could not be read.");
  }
  const caller = callerMark(request.headers);
  const ref = text(b.ref, 40);

  switch (b.action) {
    case "request": {
      // A field no person sees or fills in: a robot that fills it gets a thank-you and nothing is filed.
      if (text(b.website, 200)) return yes({ ref: "LAF-AC-0000-0000", replyDays: 3, confirmBy: null });
      const { data, error } = await booking().rpc("web_request", { p: requestPayload(b), p_caller: caller });
      if (error) {
        const e = readableError(error, "request");
        return no(e.message, e.status);
      }
      const made = data as { id: string; ref: string; replyDays: number; confirmBy: string | null };
      after(async () => {
        await queueBookingEmail(made.id, "received");
        await queueStaffAlert("new", made.id);
      });
      return yes({ ref: made.ref, replyDays: made.replyDays, confirmBy: made.confirmBy ?? null });
    }
    case "lookup": {
      const { data, error } = await booking().rpc("web_lookup", { p_ref: ref, p_caller: caller });
      if (error) {
        const e = readableError(error, "lookup");
        return no(e.message, e.status);
      }
      if (!data) return no("No booking has that Request ID. Please check it and try again.", 404);
      // The place, for the open days of "Change the date" (an id, nothing about anyone).
      const { data: row } = await booking().from("requests").select("place_id").eq("ref", (data as { ref: string }).ref).maybeSingle();
      return yes({ booking: { ...(data as Record<string, unknown>), placeId: row?.place_id ?? null } });
    }
    case "names": {
      // Each member: full name, email and under 18 (0181); whatever else was sent is dropped.
      const names = Array.isArray(b.names)
        ? b.names.slice(0, 100).map((raw) => {
            const m = (raw && typeof raw === "object" ? raw : { name: raw }) as Json;
            return { name: text(m.name, 120), email: text(m.email, 200), under18: m.under18 === true };
          })
        : [];
      const { data, error } = await booking().rpc("web_names", { p_ref: ref, p_names: names, p_caller: caller });
      if (error) {
        const e = readableError(error, "names");
        return no(e.message, e.status);
      }
      return data ? yes({ booking: data }) : no("No booking has that Request ID. Please check it and try again.", 404);
    }
    case "cancel": {
      const { data, error } = await booking().rpc("web_cancel", { p_ref: ref, p_caller: caller });
      if (error) {
        const e = readableError(error, "cancel");
        return no(e.message, e.status);
      }
      if (!data) return no("No booking has that Request ID. Please check it and try again.", 404);
      const { data: row } = await booking().from("requests").select("id").eq("ref", (data as { ref: string }).ref).maybeSingle();
      if (row) after(() => queueBookingEmail(row.id as string, "cancelled"));
      return yes({ booking: data });
    }
    case "change-date": {
      // The group moves its own booking to another open day (0184); it goes back to pending approval.
      const date = text(b.date, 10);
      const start = text(b.start_time, 5);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(start)) return no("Please choose a day and a time slot.");
      const { data, error } = await booking().rpc("web_change_date", { p_ref: ref, p_date: date, p_start: start, p_caller: caller });
      if (error) {
        const e = readableError(error, "change-date");
        return no(e.message, e.status);
      }
      if (!data) return no("No booking has that Request ID. Please check it and try again.", 404);
      const { id, ...view } = data as { id: string } & Record<string, unknown>;
      after(() => queueBookingEmail(id, "changed"));
      return yes({ booking: view });
    }
    default:
      return no("Unknown request.");
  }
}
