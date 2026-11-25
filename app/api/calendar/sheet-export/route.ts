import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { dayKey } from "@/lib/utils/dtr";
import { birthdayRows, COPY_WIDTH, copyRows, programRows, type Celebrant, type CopyEvent } from "@/lib/utils/calendar-sheet";
import type { CalendarProgram } from "@/lib/types/calendar";

export const dynamic = "force-dynamic";

/** The copy's program tabs, by the name the script asks for. */
const PROGRAM_TABS: Record<string, Exclude<CalendarProgram, "general">> = {
  "spiritual-care": "spiritual_care",
  "care-cart": "care_cart",
  "activity-center": "activity_center",
};

/**
 * ArkOS is the master calendar (owner, 25 Nov 2026): what the Calendar holds, in the columns of the Master
 * Calendar workbook's tabs, for the script inside LAF's copy of it (scripts/apps-script/calendar-copy-sync.gs)
 * to write in every 5 minutes.
 *   ?year=2026              the yearly list (general events of that year), columns A to J
 *   ?tab=spiritual-care     that program's events from 1 January of this year, in the tab's own columns
 *   ?tab=care-cart
 *   ?tab=activity-center
 *   ?tab=birthdays          the ongoing patients' names, birthdays and ages today
 *
 * Events carry the names and numbers of the people who booked them, and the birthday list carries children's
 * names, so this answers only to the calendar's own key, CALENDAR_SYNC_SECRET (on the hosting and in the copy's
 * Script Properties). It is not the key of the patients' and programs' copies, and it gives out nothing of a
 * child beyond the name and birthday the Birthday Celebrants tab has always shown. Exempt from the auth
 * middleware (no session).
 */
export async function GET(request: Request) {
  const expected = process.env.CALENDAR_SYNC_SECRET;
  if (!expected) return NextResponse.json({ ok: false, error: "The calendar export is not set up on the server." }, { status: 503 });
  const given = Buffer.from(request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  const want = Buffer.from(expected);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return NextResponse.json({ ok: false, error: "Not authorised." }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const year = params.get("year");
  const tab = params.get("tab");
  const today = dayKey(new Date());
  const answer = (body: Record<string, unknown>) => NextResponse.json({ ok: true, generatedAt: new Date().toISOString(), today, ...body }, { headers: { "cache-control": "no-store" } });
  const ops = createAdminClient().schema("ops");

  try {
    if (tab === "birthdays") {
      type P = { first_name: string | null; last_name: string | null; birth_date: string | null };
      const patients = await fetchAll<P>((from, to) => ops.from("patients").select("first_name, last_name, birth_date").eq("status", "ongoing").not("birth_date", "is", null).order("id").range(from, to));
      const people: Celebrant[] = patients.map((p) => ({ name: `${p.first_name ?? ""} ${p.last_name ?? ""}`.replace(/\s+/g, " ").trim(), birthDate: p.birth_date! }));
      // Column A (the name) is what every row has; nothing is forced to text (the age stays a number).
      return answer({ tab, width: 4, keyColumn: 1, plainFrom: 0, hidePast: false, rows: birthdayRows(people, today) });
    }

    const program = tab ? PROGRAM_TABS[tab] : undefined;
    if (tab && !program) return NextResponse.json({ ok: false, error: "No such tab." }, { status: 400 });
    if (!tab && (!year || !/^20\d{2}$/.test(year))) return NextResponse.json({ ok: false, error: "Say which year (?year=2026) or which tab (?tab=care-cart)." }, { status: 400 });

    type Row = { date: string; time: string | null; title: string; venue: string | null; officer_on_duty: string | null; staff_needed: string | null; booked_by: string | null; contact_info: string | null; remarks: string | null; menu: string | null; volunteers: string | null };
    const rows = await fetchAll<Row>((from, to) => {
      // What the Calendar page shows: an event the sheet sync hid (0034) stays out of the copy too.
      const q = ops.from("calendar_events").select("date, time, title, venue, officer_on_duty, staff_needed, booked_by, contact_info, remarks, menu, volunteers").is("sheet_removed_at", null);
      const scoped = program
        ? // ponytail: this year onward; an "all years" switch when a program's history is wanted in the copy.
          q.eq("program", program).gte("date", `${today.slice(0, 4)}-01-01`)
        : q.eq("program", "general").gte("date", `${year}-01-01`).lte("date", `${year}-12-31`);
      return scoped.order("date").order("id").range(from, to);
    });
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
      menu: r.menu,
      volunteers: r.volunteers,
    }));
    // Column D is the event on every one of these tabs; C onward is plain text; days already past are hidden.
    if (program) return answer({ tab, width: program === "care_cart" ? 9 : 7, keyColumn: 4, plainFrom: 3, hidePast: true, rows: programRows(events, program) });
    return answer({ year, width: COPY_WIDTH, keyColumn: 4, plainFrom: 3, hidePast: true, rows: copyRows(events) });
  } catch {
    return NextResponse.json({ ok: false, error: "The calendar could not be read." }, { status: 500 });
  }
}
