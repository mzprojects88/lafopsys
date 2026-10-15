import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { callerHolds } from "@/lib/rbac/server-powers";
import { dayKey } from "@/lib/utils/dtr";
import { houseSheetCsvUrl, houseSheetHtmlUrl, indexPatients, matchDeterministic, nameKey, parseRosterCsv, parseTabList, type PatientRef } from "@/lib/utils/house-sheet";
import { mergeNights, sheetNights } from "@/lib/utils/caf-sheet";
import { cafDay } from "@/lib/utils/caf";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * NCH billing (0098): the nights before the app was used, from the House Sheet's daily tabs. For a
 * draft bill, the month's tabs before the first night recorded in the app that month are read (from
 * then on the app is the record, and the sheet may disagree); a child billed to the Fund who is on a
 * day's tab stayed that night. Names are matched as the sheet sync matches them (the confirmed
 * match first, then the name rules); the new nights are added to the child's line through
 * ops.caf_set_nights with the caller's own session, so the power check and the record of who did it
 * stay in the database. Names nobody matched are returned for the social worker to add by hand.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  if (!(await callerHolds(supabase, "caf_billing"))) return NextResponse.json({ ok: false, error: "NCH billing is prepared by the social worker or the Office Admin" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as { billingId?: unknown } | null;
  const billingId = typeof body?.billingId === "string" && UUID.test(body.billingId) ? body.billingId : null;
  if (!billingId) return NextResponse.json({ ok: false, error: "Missing bill" }, { status: 400 });
  const { data: bill } = await supabase.schema("ops").from("caf_billings").select("id, month, status").eq("id", billingId).maybeSingle();
  if (!bill) return NextResponse.json({ ok: false, error: "Bill not found" }, { status: 404 });
  if (bill.status !== "draft") return NextResponse.json({ ok: false, error: "This month's bill is final; the Super Admin can reopen it" }, { status: 409 });

  // ---- the month's tabs, before the app's first recorded night that month (and up to today) ----
  const ym = String(bill.month).slice(0, 7);
  const [y, m] = ym.split("-").map(Number);
  const nextMonth = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const admin = createAdminClient();
  const { data: first } = await admin.schema("ops").from("bed_nights").select("night").gte("night", `${ym}-01`).lt("night", nextMonth).order("night").limit(1).maybeSingle();
  const today = dayKey(new Date());
  const before = first?.night && first.night <= today ? (first.night as string) : null;
  if (before === `${ym}-01`) return NextResponse.json({ ok: true, tabsRead: 0, tabsFailed: [], added: [], notCaf: 0, unmatched: [], errors: [], before });
  let tabs;
  try {
    const page = await fetch(houseSheetHtmlUrl(), { cache: "no-store", redirect: "follow" });
    if (!page.ok) throw new Error(`Google returned ${page.status} for the House Sheet`);
    tabs = parseTabList(await page.text()).filter((t) => t.date && t.date.startsWith(ym) && t.date <= today && (!before || t.date < before));
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
  const days = await Promise.all(
    tabs.map(async (t) => {
      const res = await fetch(houseSheetCsvUrl(t.gid), { cache: "no-store", redirect: "follow", headers: { accept: "text/csv" } });
      if (!res.ok) return { date: t.date!, names: [] as string[], failed: true };
      return { date: t.date!, names: parseRosterCsv(await res.text()).rows.map((r) => r.patientName), failed: false };
    })
  );

  // ---- who each name is ----
  const [{ data: settled }, { data: patientRows }] = await Promise.all([
    admin.schema("ops").from("house_sheet_people").select("name_key, matched_patient_id").in("match_status", ["auto_matched", "confirmed"]).not("matched_patient_id", "is", null),
    admin.schema("ops").from("patients").select("id, patient_number, case_number, first_name, last_name, birth_date, caf_billing"),
  ]);
  const byKey = new Map((settled ?? []).map((s) => [s.name_key as string, s.matched_patient_id as string]));
  const index = indexPatients(
    (patientRows ?? []).map((r): PatientRef => ({ id: r.id, patientNumber: r.case_number ?? r.patient_number ?? "", firstName: r.first_name, lastName: r.last_name, birthDate: r.birth_date, province: null, city: null, carerNames: [] }))
  );
  const resolve = (name: string) => {
    const settledId = byKey.get(nameKey(name));
    if (settledId) return settledId;
    const m = matchDeterministic(name, index);
    return m.kind === "candidates" ? null : m.patientId;
  };
  const { nights, unmatched } = sheetNights(days, resolve);
  const caf = new Set((patientRows ?? []).filter((p) => p.caf_billing).map((p) => p.id));
  const nameOf = new Map((patientRows ?? []).map((p) => [p.id, `${p.last_name}, ${p.first_name}`]));

  // ---- onto the bill ----
  const { data: lines } = await supabase.schema("ops").from("caf_billing_lines").select("patient_id, nights, manual_reason").eq("billing_id", billingId);
  const lineOf = new Map((lines ?? []).map((l) => [l.patient_id as string, l]));
  const added: { name: string; nights: string[] }[] = [];
  const errors: string[] = [];
  for (const [patientId, sheetDates] of nights) {
    if (!caf.has(patientId)) continue;
    const line = lineOf.get(patientId);
    const merged = mergeNights((line?.nights as string[]) ?? [], sheetDates);
    if (!merged.added.length) continue;
    const note = `Nights from the House Sheet's daily tabs`;
    const reason = line?.manual_reason && !String(line.manual_reason).includes(note) ? `${line.manual_reason}; ${note}`.slice(0, 200) : note;
    const { error } = await supabase.schema("ops").rpc("caf_set_nights", { p_billing_id: billingId, p_patient_id: patientId, p_nights: merged.all, p_reason: reason });
    if (error) errors.push(`${nameOf.get(patientId)}: ${error.message}`);
    else added.push({ name: nameOf.get(patientId) ?? "A child", nights: merged.added.map(cafDay) });
  }

  return NextResponse.json({
    ok: true,
    tabsRead: days.filter((d) => !d.failed).length,
    tabsFailed: days.filter((d) => d.failed).map((d) => d.date),
    added: added.sort((a, b) => a.name.localeCompare(b.name)),
    // Children on the tabs who aren't billed to the Fund, and names nobody on file matched.
    notCaf: [...nights.keys()].filter((id) => !caf.has(id)).length,
    unmatched,
    errors,
    before,
  });
}
