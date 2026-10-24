import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUNE", "JULY", "AUG", "SEPT", "OCT", "NOV", "DEC"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
const SOURCE_LABEL: Record<string, string> = { laf_pantry: "LAF Pantry", donation: "Donation", sponsor: "Sponsor" };

const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);
/** The sheet's week number: week 1 holds Jan 1, a new week starts every Monday (as the tabs number them). */
const weekOf = (iso: string) => {
  const d = utc(iso);
  const jan1 = Date.UTC(d.getUTCFullYear(), 0, 1);
  const firstMonday = jan1 + (((8 - new Date(jan1).getUTCDay()) % 7) || 7) * 86_400_000;
  return d.getTime() < firstMonday ? 1 : 2 + Math.floor((d.getTime() - firstMonday) / (7 * 86_400_000));
};
const sheetDate = (iso: string) => `${MONTH_SHORT[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
const usDate = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}/${iso.slice(0, 4)}`;
const time12 = (hhmm: string | null) => {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  return `${((h! + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h! < 12 ? "AM" : "PM"}`;
};

/**
 * The LAF Programs copy sheet's rows, in the original's columns, for the script inside LAF's copy
 * (scripts/apps-script/programs-copy-sync.gs) to write in every hour:
 *   ?tab=month&ym=2026-10  -> the month tab, A-N: meals per patient per day (the sheet's own rows
 *                             before Settings switched the sheet off, the app's ticks after)
 *   ?tab=care-cart&year=2026 -> the Care Cart tab, A-M, one row per dish
 *   ?tab=activity&year=2026  -> the Activity Center tab, A-N, counts only
 * Children's names: answers only to the SHEET_EXPORT_SECRET key (Vercel + the copy's Script
 * Properties), exempt from the auth middleware for that reason.
 */
export async function GET(request: Request) {
  const expected = process.env.SHEET_EXPORT_SECRET;
  if (!expected) return NextResponse.json({ ok: false, error: "The export is not set up on the server." }, { status: 503 });
  const given = Buffer.from(request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  const want = Buffer.from(expected);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return NextResponse.json({ ok: false, error: "Not authorised." }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const tab = params.get("tab");
  const year = Number(params.get("year") ?? params.get("ym")?.slice(0, 4));
  if (!Number.isInteger(year) || year < 2024 || year > 2100) return NextResponse.json({ ok: false, error: "Give a year." }, { status: 400 });
  try {
    if (tab === "month") {
      const ym = params.get("ym") ?? "";
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) return NextResponse.json({ ok: false, error: "Give ym as YYYY-MM." }, { status: 400 });
      return NextResponse.json({ ok: true, width: 14, rows: await monthRows(ym) });
    }
    if (tab === "care-cart") return NextResponse.json({ ok: true, width: 13, rows: await careCartRows(year) });
    if (tab === "activity") return NextResponse.json({ ok: true, width: 14, rows: await activityRows(year) });
    return NextResponse.json({ ok: false, error: "tab must be month, care-cart or activity." }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

type Row = (string | number)[];

/** A–N of a month tab: WEEK, DAY, DATE (first row of the day), D, CL, PATIENT, CARER, BN, M-B, M-L, M-D, L-N, N-L, PA. */
async function monthRows(ym: string): Promise<Row[]> {
  const ops = createAdminClient().schema("ops");
  const from = `${ym}-01`;
  const to = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).toISOString().slice(0, 10); // the month's last day
  const { data: settings } = await createAdminClient().schema("shared").from("app_settings").select("programs_from_app_since").eq("id", true).maybeSingle();
  const since = (settings?.programs_from_app_since as string | null | undefined) ?? null;
  const [sheetQ, appQ] = await Promise.all([
    ops.from("sheet_meals").select("date, patient_name, carer_name, bn, breakfast, lunch, dinner, sheet_row").gte("date", from).lte("date", to).order("date").order("sheet_row"),
    ops.from("meals_served").select("patient_id, date, meal").gte("date", from).lte("date", to),
  ]);
  if (sheetQ.error) throw new Error(`sheet meals: ${sheetQ.error.message}`);
  if (appQ.error) throw new Error(`meals served: ${appQ.error.message}`);
  const sheetDates = new Set((sheetQ.data ?? []).map((r) => r.date as string));
  type Line = { date: string; patient: string; carer: string; bn: number | string; b: number; l: number; d: number; order: number | string };
  const lines: Line[] = (sheetQ.data ?? [])
    .filter((r) => !since || (r.date as string) < since)
    .map((r) => ({ date: r.date as string, patient: r.patient_name as string, carer: (r.carer_name as string | null) ?? "", bn: (r.bn as number | null) ?? "", b: r.breakfast as number, l: r.lunch as number, d: r.dinner as number, order: (r.sheet_row as number | null) ?? 0 }));

  // The app's ticks: days from the switch on, and days the sheet never had.
  const appRows = (appQ.data ?? []).filter((r) => (since && (r.date as string) >= since) || !sheetDates.has(r.date as string));
  if (appRows.length) {
    const ids = [...new Set(appRows.map((r) => r.patient_id as string))];
    const [patientsQ, carersQ] = await Promise.all([
      ops.from("patients").select("id, first_name, last_name").in("id", ids),
      ops.from("carers").select("patient_id, name").in("patient_id", ids).is("effective_to", null).order("effective_from"),
    ]);
    if (patientsQ.error) throw new Error(`patients: ${patientsQ.error.message}`);
    const nameOf = new Map((patientsQ.data ?? []).map((p) => [p.id as string, `${p.last_name}, ${p.first_name}`]));
    const carerOf = new Map<string, string>();
    for (const c of carersQ.data ?? []) if (!carerOf.has(c.patient_id as string)) carerOf.set(c.patient_id as string, c.name as string);
    const byKey = new Map<string, Line>();
    for (const r of appRows) {
      const key = `${r.date}|${r.patient_id}`;
      const line = byKey.get(key) ?? { date: r.date as string, patient: nameOf.get(r.patient_id as string) ?? "Child on file", carer: carerOf.get(r.patient_id as string) ?? "", bn: "", b: 0, l: 0, d: 0, order: nameOf.get(r.patient_id as string) ?? "" };
      // The app ticks a family once; the sheet counted people (patient + carer = 2).
      if (r.meal === "breakfast") line.b = 2;
      if (r.meal === "lunch") line.l = 2;
      if (r.meal === "dinner") line.d = 2;
      byKey.set(key, line);
    }
    lines.push(...byKey.values());
  }
  lines.sort((a, b) => a.date.localeCompare(b.date) || String(a.order).localeCompare(String(b.order), undefined, { numeric: true }));
  let prev = "";
  return lines.map((l) => {
    const first = l.date !== prev;
    prev = l.date;
    return [`WEEK ${weekOf(l.date)}`, DAYS[utc(l.date).getUTCDay()]!, first ? sheetDate(l.date) : "", "", "", l.patient, l.carer, l.bn, l.b, l.l, l.d, "", "", ""];
  });
}

/** A–M of the Care Cart tab: MONTH, WEEK, DATE, TIME, FOOD, PCS/KG, COST, TOTAL, SERVINGS, SOURCE, # VOLUNTEERS, (names), SPONSOR. */
async function careCartRows(year: number): Promise<Row[]> {
  const inv = createAdminClient().schema("inventory");
  const { data: runs, error } = await inv
    .from("care_cart_runs")
    .select("id, date, time_slot, source, sponsor, volunteer_count, care_cart_run_dishes(dish, quantity, unit, servings, standard_cost, sort_order)")
    .gte("date", `${year}-01-01`)
    .lte("date", `${year}-12-31`)
    .neq("delivery_status", "cancelled")
    .order("date")
    .order("time_slot");
  if (error) throw new Error(`care cart: ${error.message}`);
  const rows: Row[] = [];
  for (const run of runs ?? []) {
    const date = run.date as string;
    const dishes = ([...((run.care_cart_run_dishes as Record<string, unknown>[] | null) ?? [])].sort((a, b) => Number(a.sort_order) - Number(b.sort_order)));
    const source = run.source === "sponsor" ? (run.sponsor as string | null) || "Sponsor" : (SOURCE_LABEL[run.source as string] ?? "");
    const lines = dishes.length ? dishes : [{}];
    lines.forEach((d, i) => {
      const cost = Number(d.standard_cost ?? 0);
      const servings = Number(d.servings ?? 0);
      rows.push([
        MONTHS[Number(date.slice(5, 7)) - 1]!,
        `WEEK ${weekOf(date)}`,
        i === 0 ? usDate(date) : "",
        i === 0 ? time12(run.time_slot as string | null) : "",
        (d.dish as string | undefined) ?? "",
        d.quantity != null ? `${d.quantity} ${(d.unit as string | null) ?? ""}`.trim() : "",
        cost || "",
        cost && servings ? Math.round(cost * servings * 100) / 100 : "",
        servings || "",
        i === 0 ? source : "",
        i === 0 ? ((run.volunteer_count as number | null) ?? "") : "",
        "",
        i === 0 && run.source === "sponsor" ? ((run.sponsor as string | null) ?? "") : "",
      ]);
    });
  }
  return rows;
}

/** A–N of the Activity Center tab: MONTH, WEEK, DATE, TIME, (names), NCH #, NCH HOURS, (names), NCH # VOL, (blank), (names), LAF #, LAF # VOL, (names). */
async function activityRows(year: number): Promise<Row[]> {
  const ops = createAdminClient().schema("ops");
  const { data, error } = await ops.from("activity_sessions").select("date, title, participants, volunteer_count, hours, facilitator, source").gte("date", `${year}-01-01`).lte("date", `${year}-12-31`).order("date");
  if (error) throw new Error(`activity center: ${error.message}`);
  const byDate = new Map<string, { time: string; nch?: Record<string, unknown>; laf?: Record<string, unknown> }>();
  for (const s of data ?? []) {
    const date = s.date as string;
    const day = byDate.get(date) ?? { time: "" };
    if (s.source === "sheet" && s.facilitator) day.time = s.facilitator as string;
    if (/@ LAF$/.test(s.title as string)) day.laf = s;
    else day.nch = s;
    byDate.set(date, day);
  }
  return [...byDate.entries()].map(([date, d]) => [
    MONTHS[Number(date.slice(5, 7)) - 1]!,
    `WEEK ${weekOf(date)}`,
    usDate(date),
    d.time,
    "",
    d.nch ? Number(d.nch.participants) : "",
    d.nch ? Number(d.nch.hours) : "",
    "",
    d.nch ? Number(d.nch.volunteer_count) : "",
    "",
    "",
    d.laf ? Number(d.laf.participants) : "",
    d.laf ? Number(d.laf.volunteer_count) : "",
    "",
  ]);
}
