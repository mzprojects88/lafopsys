import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { dayKey } from "@/lib/utils/dtr";
import { COPY_WIDTH, copyRows, type CopyEvent } from "@/lib/utils/calendar-sheet";

export const dynamic = "force-dynamic";

/**
 * ArkOS is the master calendar (owner, 25 Nov 2026): every event the Calendar page shows, in the
 * columns of the Master Calendar sheet's list tab, for the script inside LAF's copy of that sheet
 * (scripts/apps-script/calendar-copy-sync.gs) to write in every 5 minutes.
 *
 * Events carry the names and numbers of the people who booked them, so this answers only to the
 * calendar's own key, CALENDAR_SYNC_SECRET (on the hosting and in the copy's Script Properties).
 * It is not the key of the patients' and programs' copies: the calendar copy is read by many more
 * people, and its key must not open those. Exempt from the auth middleware (no session).
 */
export async function GET(request: Request) {
  const expected = process.env.CALENDAR_SYNC_SECRET;
  if (!expected) return NextResponse.json({ ok: false, error: "The calendar export is not set up on the server." }, { status: 503 });
  const given = Buffer.from(request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  const want = Buffer.from(expected);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return NextResponse.json({ ok: false, error: "Not authorised." }, { status: 401 });

  // The sheet has a tab per year ("2026", "2027"): the script asks for one year at a time.
  const year = new URL(request.url).searchParams.get("year");
  if (!year || !/^20\d{2}$/.test(year)) return NextResponse.json({ ok: false, error: "Say which year: ?year=2026" }, { status: 400 });

  type Row = { date: string; time: string | null; title: string; venue: string | null; officer_on_duty: string | null; staff_needed: string | null; booked_by: string | null; contact_info: string | null; remarks: string | null };
  let rows: Row[];
  try {
    const ops = createAdminClient().schema("ops");
    // What the Calendar page shows: an event the sheet sync hid (0034) stays out of the copy too.
    rows = await fetchAll<Row>((from, to) =>
      ops
        .from("calendar_events")
        .select("date, time, title, venue, officer_on_duty, staff_needed, booked_by, contact_info, remarks")
        .is("sheet_removed_at", null)
        .gte("date", `${year}-01-01`)
        .lte("date", `${year}-12-31`)
        .order("date")
        .order("id")
        .range(from, to)
    );
  } catch {
    return NextResponse.json({ ok: false, error: "The calendar could not be read." }, { status: 500 });
  }
  const events: CopyEvent[] = rows.map((r) => ({
    date: r.date,
    time: r.time,
    title: r.title,
    venue: r.venue,
    officerOnDuty: r.officer_on_duty,
    staffNeeded: r.staff_needed,
    bookedBy: r.booked_by,
    contactInfo: r.contact_info,
    remarks: r.remarks,
  }));

  return NextResponse.json(
    { ok: true, generatedAt: new Date().toISOString(), year, today: dayKey(new Date()), width: COPY_WIDTH, rows: copyRows(events) },
    { headers: { "cache-control": "no-store" } }
  );
}
