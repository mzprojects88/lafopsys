import { NextResponse, after } from "next/server";
import { UUID, callerMark, queueBookingEmail, readableError } from "@/lib/booking/server";
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

/** Only the fields the form has; whatever else was sent is dropped before the database sees it. */
function requestPayload(b: Json): Json {
  const items = Array.isArray(b.items) ? b.items.slice(0, 4) : [];
  return {
    place_id: text(b.place_id, 36),
    date: text(b.date, 10),
    start_time: text(b.start_time, 5),
    requestor_name: text(b.requestor_name, 200),
    requestor_kind: text(b.requestor_kind, 20),
    contact_person: text(b.contact_person, 200),
    email: text(b.email, 250),
    mobile: text(b.mobile, 60),
    volunteers_count: Number.isInteger(b.volunteers_count) ? b.volunteers_count : 0,
    has_minors: b.has_minors === true,
    agree_guidelines: b.agree_guidelines === true,
    agree_privacy: b.agree_privacy === true,
    items: items.map((raw) => {
      const i = (raw && typeof raw === "object" ? raw : {}) as Json;
      return {
        source: text(i.source, 12),
        plan_item_id: text(i.plan_item_id, 36),
        activity: text(i.activity, 120),
        purpose: text(i.purpose, 300),
        who: text(i.who, 10),
        ages: text(i.ages, 40),
        gender: text(i.gender, 6),
        start_time: text(i.start_time, 5),
        end_time: text(i.end_time, 5),
        materials: text(i.materials, 500),
      };
    }),
  };
}

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
      if (text(b.website, 200)) return yes({ ref: "LAF-AC-0000-0000", replyDays: 3 });
      const { data, error } = await booking().rpc("web_request", { p: requestPayload(b), p_caller: caller });
      if (error) {
        const e = readableError(error, "request");
        return no(e.message, e.status);
      }
      const made = data as { id: string; ref: string; replyDays: number };
      after(() => queueBookingEmail(made.id, "received"));
      return yes({ ref: made.ref, replyDays: made.replyDays });
    }
    case "lookup": {
      const { data, error } = await booking().rpc("web_lookup", { p_ref: ref, p_caller: caller });
      if (error) {
        const e = readableError(error, "lookup");
        return no(e.message, e.status);
      }
      return data ? yes({ booking: data }) : no("No booking has that Request ID. Please check it and try again.", 404);
    }
    case "names": {
      const names = Array.isArray(b.names) ? b.names.slice(0, 100).map((n) => text(n, 120)) : [];
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
    default:
      return no("Unknown request.");
  }
}
