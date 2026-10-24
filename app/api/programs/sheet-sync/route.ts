import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSheetMatcher } from "@/lib/server/sheet-people";
import { parseCsv } from "@/lib/utils/bank-statement";
import { dayKey } from "@/lib/utils/dtr";
import { houseSheetCsvUrl, houseSheetHtmlUrl, parseTabList } from "@/lib/utils/house-sheet";
import { activitySessions, type SheetActivity } from "@/lib/utils/programs-activity";
import { runsFromSheet, type SheetRow } from "@/lib/utils/programs-care-cart";
import { headcounts, monthTab, patientMeals, type PatientMeals } from "@/lib/utils/programs-sheet";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** "LAF Programs 2026": staff's daily record of meals per patient and the Care Cart. */
const PROGRAMS_SHEET_ID = "1_kprlQd0xMnYcmjuqU6sg-VT1glC1GBktpSkdm-KMN0";
const HOUSE = "house-laf-main";
const RUNNING_GUARD_MS = 5 * 60_000;
const AI_BUDGET_MS = 120_000;

/**
 * The LAF Programs sheet into the app (0103, Inventory 0065), every half hour by pg_cron (bearer
 * CALENDAR_SYNC_SECRET) or "Check now" by a House Ops editor, until Settings switches the sheet off
 * (app_settings.programs_from_app_since).
 *
 *  - Month tabs: each patient's breakfast / lunch / dinner per day into ops.sheet_meals (names matched
 *    as the House Sheet does), and each day's headcounts into inventory.meal_services (source 'sheet';
 *    dish, notes and draw links kept).
 *  - Care Cart tab: runs (date + time) with their dishes into inventory.care_cart_runs; a run already
 *    recorded in the app for that date and time is taken over (sheet_key), not doubled.
 *  - Activity Center tab (0107): one session per day and site (NCH, LAF) with its counts into
 *    ops.activity_sessions (sheet_key date|site); sessions added in the app are left alone.
 * A tab whose text is unchanged since its last good read is skipped. Only counts are returned.
 */
export async function POST(request: Request) {
  let body: { force?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    // An empty body is fine.
  }
  const force = body.force === true;

  let trigger: "cron" | "manual";
  let triggeredBy: string | null = null;
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (bearer !== undefined) {
    const expected = process.env.CALENDAR_SYNC_SECRET;
    if (!expected) return NextResponse.json({ ok: false, error: "CALENDAR_SYNC_SECRET is not configured on the server." }, { status: 500 });
    const a = Buffer.from(bearer);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return NextResponse.json({ ok: false, error: "Not authorised." }, { status: 401 });
    trigger = "cron";
  } else {
    const session = await createClient();
    const { data: userData } = await session.auth.getUser();
    if (!userData.user) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
    const { data: canEdit } = await session.schema("shared").rpc("module_editable", { p_module: "house_ops" });
    if (canEdit !== true) return NextResponse.json({ ok: false, error: "Your access to House Operations is view only." }, { status: 403 });
    trigger = "manual";
    triggeredBy = userData.user.id;
  }

  const admin = createAdminClient();
  const { data: settings } = await admin.schema("shared").from("app_settings").select("programs_from_app_since").eq("id", true).maybeSingle();
  if (settings?.programs_from_app_since) return NextResponse.json({ ok: true, skipped: "switched off" });
  const { data: running } = await admin
    .schema("ops")
    .from("programs_sync_runs")
    .select("id")
    .eq("status", "running")
    .gte("started_at", new Date(Date.now() - RUNNING_GUARD_MS).toISOString())
    .limit(1);
  if (running && running.length > 0) return NextResponse.json({ ok: false, error: "A check is already running." }, { status: 409 });

  const today = dayKey(new Date());
  let tabs;
  try {
    const page = await fetch(houseSheetHtmlUrl(PROGRAMS_SHEET_ID), { cache: "no-store", redirect: "follow" });
    if (!page.ok) throw new Error(`Google returned ${page.status} for the LAF Programs sheet — is it still shared as "anyone with the link"?`);
    tabs = parseTabList(await page.text());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await admin.schema("ops").from("programs_sync_runs").insert({ trigger, triggered_by: triggeredBy, tab: "(tab list)", status: "failed", finished_at: new Date().toISOString(), error: message.slice(0, 4000) });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }

  // Every month tab up to this month; one whose text hasn't changed costs a download and is skipped.
  const thisMonth = today.slice(0, 7);
  const months = tabs
    .flatMap((t) => {
      const m = monthTab(t.name);
      return m ? [{ ...t, ...m, ym: `${m.year}-${String(m.month).padStart(2, "0")}` }] : [];
    })
    .filter((t) => t.ym <= thisMonth)
    .sort((a, b) => a.ym.localeCompare(b.ym));
  const careCart = tabs.find((t) => t.name.trim().toLowerCase() === "care cart");
  const activity = tabs.find((t) => t.name.trim().toLowerCase() === "activity center");

  const matcher = createSheetMatcher(admin, AI_BUDGET_MS);
  const results: Record<string, unknown>[] = [];
  let anyFailed = false;

  const readTab = async (name: string, gid: string, work: (rows: string[][]) => Promise<{ seen: number; written: number; errors: string[] }>) => {
    let csv: string;
    try {
      const res = await fetch(houseSheetCsvUrl(gid, PROGRAMS_SHEET_ID), { cache: "no-store", redirect: "follow", headers: { accept: "text/csv" } });
      if (!res.ok || !(res.headers.get("content-type") ?? "").includes("text/csv")) throw new Error(`Google returned ${res.status} for tab ${name}.`);
      csv = await res.text();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await admin.schema("ops").from("programs_sync_runs").insert({ trigger, triggered_by: triggeredBy, tab: name, status: "failed", finished_at: new Date().toISOString(), error: message.slice(0, 4000) });
      anyFailed = true;
      results.push({ tab: name, status: "failed", error: message });
      return;
    }
    const hash = createHash("sha256").update(csv).digest("hex");
    const { data: last } = await admin.schema("ops").from("programs_sync_runs").select("csv_hash").eq("tab", name).eq("status", "success").order("started_at", { ascending: false }).limit(1).maybeSingle();
    if (!force && last?.csv_hash === hash) return; // unchanged: no run row
    const { data: run } = await admin.schema("ops").from("programs_sync_runs").insert({ trigger, triggered_by: triggeredBy, tab: name }).select("id").single();
    try {
      const r = await work(parseCsv(csv, true));
      const hard = r.errors.filter((e) => !e.startsWith("model on "));
      await admin
        .schema("ops")
        .from("programs_sync_runs")
        .update({ status: hard.length ? "failed" : "success", finished_at: new Date().toISOString(), csv_hash: hash, rows_seen: r.seen, written: r.written, error: r.errors.join("\n").slice(0, 4000) || null })
        .eq("id", run!.id);
      if (hard.length) anyFailed = true;
      results.push({ tab: name, status: hard.length ? "failed" : "success", seen: r.seen, written: r.written, problems: hard.length });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await admin.schema("ops").from("programs_sync_runs").update({ status: "failed", finished_at: new Date().toISOString(), error: message.slice(0, 4000) }).eq("id", run!.id);
      anyFailed = true;
      results.push({ tab: name, status: "failed", error: message });
    }
  };

  for (const tab of months) {
    await readTab(tab.name, tab.gid, async (rows) => {
      const meals = patientMeals(rows, tab.year).filter((m) => m.date <= today);
      const errors: string[] = [];
      if (meals.length === 0) return { seen: 0, written: 0, errors };
      const written = await saveMeals(admin, meals);
      await matcher.addUnseen(meals.map((m) => ({ nameKey: m.nameKey, patientName: m.patientName, carerName: m.carerName, date: m.date })), errors);
      await saveHeadcounts(admin, meals);
      return { seen: meals.length, written, errors };
    });
  }

  if (careCart) {
    await readTab(careCart.name, careCart.gid, async (rows) => {
      const sheetRows: SheetRow[] = rows.slice(1).map((cells, i) => ({ sheetRow: i + 2, cells: [...cells, ...Array(11).fill("")].slice(0, 11) }));
      const runs = runsFromSheet(sheetRows).runs.filter((r) => r.timeSlot && r.date <= today);
      return { seen: runs.length, written: await saveCareCart(admin, runs), errors: [] };
    });
  }

  if (activity) {
    await readTab(activity.name, activity.gid, async (rows) => {
      const sessions = activitySessions(rows).filter((a) => a.date <= today);
      return { seen: sessions.length, written: await saveActivity(admin, sessions), errors: [] };
    });
  }

  return NextResponse.json({ ok: !anyFailed, tabs: results });
}

/** The sheet's sessions by sheet_key: updated in place, added, or removed when gone from the sheet. */
async function saveActivity(admin: SupabaseClient, sessions: SheetActivity[]) {
  const { data: existing, error } = await admin.schema("ops").from("activity_sessions").select("id, sheet_key").eq("source", "sheet");
  if (error) throw new Error(`activity center: ${error.message}`);
  const { error: upsertError } = await admin.schema("ops").from("activity_sessions").upsert(
    sessions.map((a) => ({ sheet_key: a.sheetKey, source: "sheet", date: a.date, title: `Activity Center @ ${a.site}`, participants: a.participants, volunteer_count: a.volunteers, hours: a.hours, facilitator: a.time || null })),
    { onConflict: "sheet_key" }
  );
  if (upsertError) throw new Error(`activity center: ${upsertError.message}`);
  const keep = new Set(sessions.map((a) => a.sheetKey));
  const gone = (existing ?? []).filter((e) => e.sheet_key && !keep.has(e.sheet_key as string)).map((e) => e.id as string);
  if (gone.length) {
    const { error: deleteError } = await admin.schema("ops").from("activity_sessions").delete().in("id", gone);
    if (deleteError) throw new Error(`activity center: ${deleteError.message}`);
  }
  return sessions.length;
}

/** A date's rows replace that date's (a date not on the tab is left as it was). */
async function saveMeals(admin: SupabaseClient, meals: PatientMeals[]) {
  const now = new Date().toISOString();
  const { error } = await admin
    .schema("ops")
    .from("sheet_meals")
    .upsert(
      meals.map((m) => ({ date: m.date, name_key: m.nameKey, patient_name: m.patientName, carer_name: m.carerName, bn: m.bn, breakfast: m.breakfast, lunch: m.lunch, dinner: m.dinner, sheet_row: m.sheetRow, synced_at: now })),
      { onConflict: "date,name_key" }
    );
  if (error) throw new Error(`meals: ${error.message}`);
  const dates = [...new Set(meals.map((m) => m.date))];
  const keep = new Set(meals.map((m) => `${m.date}|${m.nameKey}`));
  const { data: stored } = await admin.schema("ops").from("sheet_meals").select("date, name_key").in("date", dates);
  for (const s of (stored ?? []).filter((s) => !keep.has(`${s.date}|${s.name_key}`))) {
    await admin.schema("ops").from("sheet_meals").delete().eq("date", s.date).eq("name_key", s.name_key);
  }
  return meals.length;
}

/** Each day's headcounts into LAF Inventory's meals; an existing row keeps its id, dish, notes and draws. */
async function saveHeadcounts(admin: SupabaseClient, meals: PatientMeals[]) {
  const counts = headcounts(meals);
  const dates = [...new Set(counts.map((c) => c.date))];
  const { data: existing, error } = await admin.schema("inventory").from("meal_services").select("id, date, meal_type, patients, carers").eq("house_id", HOUSE).in("date", dates);
  if (error) throw new Error(`kitchen meals: ${error.message}`);
  const byKey = new Map((existing ?? []).map((e) => [`${e.date}|${e.meal_type}`, e]));
  for (const c of counts) {
    const e = byKey.get(`${c.date}|${c.mealType}`);
    if (e && e.patients === c.patients && e.carers === c.carers) continue;
    const { error: writeError } = e
      ? await admin.schema("inventory").from("meal_services").update({ patients: c.patients, carers: c.carers }).eq("id", e.id)
      : c.patients + c.carers === 0
        ? { error: null }
        : await admin
            .schema("inventory")
            .from("meal_services")
            .insert({ id: `meal-sheet-${c.date}-${c.mealType}`, house_id: HOUSE, date: c.date, meal_type: c.mealType, patients: c.patients, carers: c.carers, others: 0, source: "sheet", recorded_by: "LAF Programs sheet" });
    if (writeError) throw new Error(`kitchen meals ${c.date} ${c.mealType}: ${writeError.message}`);
  }
}

/** The sheet's runs into LAF Inventory's Care Cart: found by sheet_key, else by date and time (taken
 * over), else added. A sheet run that left the sheet is removed unless stock was drawn for it. */
async function saveCareCart(admin: SupabaseClient, runs: ReturnType<typeof runsFromSheet>["runs"]) {
  const inv = () => admin.schema("inventory");
  const { data: existing, error } = await inv().from("care_cart_runs").select("id, date, time_slot, sheet_key").neq("delivery_status", "cancelled");
  if (error) throw new Error(`care cart: ${error.message}`);
  const byKey = new Map((existing ?? []).filter((r) => r.sheet_key).map((r) => [r.sheet_key as string, r]));
  const bySlot = new Map((existing ?? []).filter((r) => !r.sheet_key && r.time_slot).map((r) => [`${r.date}|${r.time_slot}`, r]));
  const seen = new Set<string>();
  let written = 0;
  for (const run of runs) {
    const key = `${run.date}|${run.timeSlot}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const fields = { served_count: run.servedCount, source: run.source, sponsor: run.sponsor, volunteer_count: run.volunteerCount, notes: run.notes, sheet_key: key, delivery_status: "delivered" };
    const found = byKey.get(key) ?? bySlot.get(key);
    let id: string;
    if (found) {
      id = found.id as string;
      const { error: e } = await inv().from("care_cart_runs").update(fields).eq("id", id);
      if (e) throw new Error(`care cart ${key}: ${e.message}`);
    } else {
      id = `ccr-sheet-${run.date}-${run.timeSlot!.replace(":", "")}`;
      const { error: e } = await inv()
        .from("care_cart_runs")
        .insert({ id, date: run.date, time_slot: run.timeSlot, status: "draft", recorded_by: "LAF Programs sheet", delivered_by: "LAF Programs sheet", delivered_at: run.date, ...fields });
      if (e) throw new Error(`care cart ${key}: ${e.message}`);
    }
    await inv().from("care_cart_run_dishes").delete().eq("run_id", id);
    if (run.dishes.length) {
      const { error: e } = await inv()
        .from("care_cart_run_dishes")
        .insert(run.dishes.map((d, i) => ({ id: `ccd-sheet-${id}-${i}`, run_id: id, dish: d.dish, quantity: d.quantity, unit: d.unit, servings: d.servings, standard_cost: d.standardCost, sort_order: i })));
      if (e) throw new Error(`care cart dishes ${key}: ${e.message}`);
    }
    written++;
  }
  for (const r of existing ?? []) {
    if (!r.sheet_key || seen.has(r.sheet_key)) continue;
    const { count } = await inv().from("transactions").select("id", { count: "exact", head: true }).eq("care_cart_run_id", r.id);
    if (count) continue;
    await inv().from("care_cart_run_dishes").delete().eq("run_id", r.id);
    await inv().from("care_cart_runs").delete().eq("id", r.id);
  }
  return written;
}
