import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSheetMatcher, type ToMatch } from "@/lib/server/sheet-people";
import { dayKey } from "@/lib/utils/dtr";
import {
  houseSheetCsvUrl,
  houseSheetHtmlUrl,
  parseRosterCsv,
  parseTabList,
  reconcileRoster,
  type DbSheetPerson,
  type RosterRow,
} from "@/lib/utils/house-sheet";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const RUNNING_GUARD_MS = 5 * 60_000;
const MAX_DAYS = 60;
/** Past tabs re-read each run for edits (nights only, silently skipped when unchanged). */
const RECHECK_TABS = 7;
/** Tabs never saved as nights, read per run, newest first: the history fills in a few hours. */
const BACKFILL_TABS = 40;
const AI_BUDGET_MS = 180_000;
const AI_MAX_ATTEMPTS = 3;

/**
 * Reads the house's Occupancy Tracker (one Google Sheet tab per day) into
 * ops.house_sheet_people and resolves each roster name to a patient.
 *
 * Called by pg_cron every half hour with a bearer secret (0046), and by a
 * social worker's or admin's "Check now" with their session. Exempt from
 * the auth middleware for the first, so it checks here. `days` reads that
 * many newest tabs, oldest first, to fill in a gap (the cron sends none).
 *
 * Deciding lives in lib/utils/house-sheet.ts and lib/ai/openai.ts; this file
 * fetches, reads, writes and records. Every tab checked leaves a run row.
 * The day's headcount is also written to ops.census_snapshots, the table
 * the dashboards and the DSWD figures already read.
 *
 * Every tab read is also kept as that night's roster in ops.sheet_nights
 * (0100: the sheet is the nightly record until Settings says otherwise). A
 * scheduled run reads the newest tab in full, plus -- nights only -- the
 * past week's tabs when they changed and up to BACKFILL_TABS never saved.
 * Nights only never reconciles an old tab (that would mark today's families
 * off-sheet); it adds names never seen, off-sheet, for matching.
 */
export async function POST(request: Request) {
  let body: { trigger?: unknown; force?: unknown; days?: unknown } = {};
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
    const {
      data: { user },
    } = await session.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
    // Patients edit in Settings -> Roles & Access (0050); inactive staff have no role, so no level.
    const { data: canEdit } = await session.schema("shared").rpc("module_editable", { p_module: "patients" });
    if (canEdit !== true) {
      return NextResponse.json({ ok: false, error: "Your access to Patients is view only." }, { status: 403 });
    }
    trigger = "manual";
    triggeredBy = user.id;
  }
  // `days` fills a gap: that many newest tabs, oldest first. The cron's fixed body carries none.
  const days = typeof body.days === "number" ? Math.max(1, Math.min(MAX_DAYS, Math.floor(body.days))) : 1;

  const admin = createAdminClient();

  const { data: settings } = await admin.schema("shared").from("app_settings").select("house_sheet_sync_enabled").eq("id", true).maybeSingle();
  if (settings && settings.house_sheet_sync_enabled === false) return NextResponse.json({ ok: true, skipped: "disabled" });

  const { data: running } = await admin
    .schema("ops")
    .from("house_sheet_sync_runs")
    .select("id")
    .eq("status", "running")
    .gte("started_at", new Date(Date.now() - RUNNING_GUARD_MS).toISOString())
    .limit(1);
  if (running && running.length > 0) return NextResponse.json({ ok: false, error: "A check is already running." }, { status: 409 });

  // ---- which tabs ----
  let tabs;
  try {
    const page = await fetch(houseSheetHtmlUrl(), { cache: "no-store", redirect: "follow" });
    if (!page.ok) throw new Error(`Google returned ${page.status} for the workbook — is it still shared as "anyone with the link"?`);
    // A tab made ahead for tomorrow is empty until the morning; reading it
    // would empty the house. Only tabs up to Manila today count.
    const today = dayKey(new Date());
    tabs = parseTabList(await page.text()).filter((t) => t.date !== null && t.date <= today);
    if (tabs.length === 0) throw new Error("The workbook has no tab named as a date up to today.");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await admin.schema("ops").from("house_sheet_sync_runs").insert({ trigger, triggered_by: triggeredBy, status: "failed", finished_at: new Date().toISOString(), error: message.slice(0, 4000) });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
  // A manual `days` reads every tab in full, as before. Otherwise: nights only for the past week's
  // tabs and the never-saved ones, then the newest tab in full, last, so it is the latest run.
  let chosen: { tab: (typeof tabs)[number]; full: boolean }[];
  if (typeof body.days === "number") {
    chosen = tabs.slice(0, days).reverse().map((tab) => ({ tab, full: true })); // oldest first, so a person's day count grows in order
  } else {
    const unsaved: typeof tabs = [];
    const older = tabs.slice(1 + RECHECK_TABS);
    for (let i = 0; i < older.length && unsaved.length < BACKFILL_TABS; i += BACKFILL_TABS) {
      const chunk = older.slice(i, i + BACKFILL_TABS);
      const { data: saved } = await admin.schema("ops").from("house_sheet_sync_runs").select("tab_date").in("tab_date", chunk.map((t) => t.date!)).not("nights_saved", "is", null);
      const savedDays = new Set((saved ?? []).map((r) => r.tab_date as string));
      unsaved.push(...chunk.filter((t) => !savedDays.has(t.date!)));
    }
    chosen = [...tabs.slice(1, 1 + RECHECK_TABS), ...unsaved.slice(0, BACKFILL_TABS)]
      .reverse()
      .map((tab) => ({ tab, full: false }))
      .concat({ tab: tabs[0], full: true });
  }

  // ---- that night's roster: the sheet's nightly record (0100) ----
  const saveNights = async (night: string, rows: RosterRow[]) => {
    const { error } = await admin
      .schema("ops")
      .from("sheet_nights")
      .upsert(
        rows.map((r) => ({
          night,
          name_key: r.nameKey,
          patient_name: r.patientName,
          carer_name: r.carerName,
          relationship: r.relationship,
          next_appointment_raw: r.nextAppointmentRaw,
          treatment: r.treatment,
          address: r.address,
          phone: r.phone,
          row_no: r.rowNo,
          synced_at: new Date().toISOString(),
        })),
        { onConflict: "night,name_key" }
      );
    if (error) throw new Error(`nights ${night}: ${error.message}`);
    const keep = new Set(rows.map((r) => r.nameKey));
    const { data: stored } = await admin.schema("ops").from("sheet_nights").select("name_key").eq("night", night);
    const gone = (stored ?? []).map((s) => s.name_key as string).filter((k) => !keep.has(k));
    if (gone.length > 0) {
      const { error: delError } = await admin.schema("ops").from("sheet_nights").delete().eq("night", night).in("name_key", gone);
      if (delError) throw new Error(`nights ${night}: ${delError.message}`);
    }
  };

  const matcher = createSheetMatcher(admin, AI_BUDGET_MS);
  const matchPeople = matcher.matchPeople;

  const results: Record<string, unknown>[] = [];
  let anyFailed = false;


  for (const { tab, full } of chosen) {
    let csv: string;
    try {
      const response = await fetch(houseSheetCsvUrl(tab.gid), { cache: "no-store", redirect: "follow", headers: { accept: "text/csv" } });
      const contentType = response.headers.get("content-type") ?? "";
      if (!response.ok || !contentType.includes("text/csv")) throw new Error(`Google returned ${response.status} ${contentType || "(no content type)"} for tab ${tab.name}.`);
      csv = await response.text();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await admin.schema("ops").from("house_sheet_sync_runs").insert({ trigger, triggered_by: triggeredBy, tab_date: tab.date, tab_gid: tab.gid, status: "failed", finished_at: new Date().toISOString(), error: message.slice(0, 4000) });
      anyFailed = true;
      results.push({ tab: tab.name, status: "failed", error: message });
      continue;
    }
    const hash = createHash("sha256").update(csv).digest("hex");

    // Unchanged since its roster was last saved: the newest tab logs it, a past tab is skipped quietly.
    const { data: last } = await admin
      .schema("ops")
      .from("house_sheet_sync_runs")
      .select("csv_hash, rows_seen, nights_saved")
      .eq("tab_date", tab.date)
      .in("status", ["success", "unchanged"])
      .not("nights_saved", "is", null)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!force && last?.csv_hash === hash) {
      if (full) {
        await admin
          .schema("ops")
          .from("house_sheet_sync_runs")
          .insert({ trigger, triggered_by: triggeredBy, tab_date: tab.date, tab_gid: tab.gid, status: "unchanged", finished_at: new Date().toISOString(), csv_hash: hash, rows_seen: last.rows_seen ?? 0, nights_saved: last.nights_saved });
        results.push({ tab: tab.name, status: "unchanged" });
      }
      continue;
    }

    const { data: run, error: runError } = await admin
      .schema("ops")
      .from("house_sheet_sync_runs")
      .insert({ trigger, triggered_by: triggeredBy, tab_date: tab.date, tab_gid: tab.gid })
      .select("id")
      .single();
    if (runError || !run) return NextResponse.json({ ok: false, error: runError?.message ?? "Could not record the run." }, { status: 500 });
    const runId = run.id as string;
    const finish = async (fields: Record<string, unknown>) => {
      await admin.schema("ops").from("house_sheet_sync_runs").update({ ...fields, finished_at: new Date().toISOString() }).eq("id", runId);
    };

    try {
      const parsed = parseRosterCsv(csv);
      if (parsed.rows.length === 0 && parsed.problems.length > 0) throw new Error(parsed.problems[0]);
      if (parsed.rows.length === 0) {
        // Nobody has filled the tab in yet: not "the house is empty", and tonight's saved roster stays.
        // A past empty tab is marked read so the backfill moves on; the week's re-check still sees an edit.
        await finish({ status: "success", csv_hash: hash, rows_seen: 0, nights_saved: full ? null : 0 });
        results.push({ tab: tab.name, status: "success", counts: { seen: 0 }, problems: ["The tab has no names yet."] });
        continue;
      }

      if (!full) {
        // Nights only: the roster, and names never seen (off-sheet, no appointment) for matching.
        const errors: string[] = [...parsed.problems];
        await saveNights(tab.date!, parsed.rows);
        const { inserted, ...counts } = await matcher.addUnseen(
          parsed.rows.map((r) => ({
            nameKey: r.nameKey,
            patientName: r.patientName,
            carerName: r.carerName,
            date: tab.date!,
            extra: { relationship: r.relationship, treatment: r.treatment, address: r.address, laf_flag: r.lafFlag, phone: r.phone, row_no: r.rowNo },
          })),
          errors
        );
        const hardErrors = errors.filter((e) => !e.startsWith("model on "));
        await finish({
          status: hardErrors.length === 0 ? "success" : "failed",
          csv_hash: hash,
          rows_seen: parsed.rows.length,
          inserted,
          auto_matched: counts.autoMatched,
          suggested: counts.suggested,
          unmatched: counts.unmatched,
          ai_calls: counts.aiCalls,
          nights_saved: parsed.rows.length,
          error: errors.length > 0 ? errors.join("\n").slice(0, 4000) : null,
        });
        if (hardErrors.length > 0) anyFailed = true;
        results.push({ tab: tab.name, status: hardErrors.length === 0 ? "success" : "failed", nightsOnly: true, counts: { seen: parsed.rows.length, inserted, ...counts } });
        continue;
      }

      const { data: dbRows, error: dbError } = await admin
        .schema("ops")
        .from("house_sheet_people")
        .select("id, name_key, patient_name, carer_name, relationship, next_appointment_raw, next_appointment_on, treatment, address, laf_flag, phone, first_seen_on, last_seen_on, days_seen, off_sheet_at");
      if (dbError) throw new Error(dbError.message);
      type PRow = {
        id: string;
        name_key: string;
        patient_name: string;
        carer_name: string | null;
        relationship: string | null;
        next_appointment_raw: string | null;
        next_appointment_on: string | null;
        treatment: string | null;
        address: string | null;
        laf_flag: boolean;
        phone: string | null;
        first_seen_on: string;
        last_seen_on: string;
        days_seen: number;
        off_sheet_at: string | null;
      };
      const db: DbSheetPerson[] = ((dbRows ?? []) as PRow[]).map((r) => ({
        id: r.id,
        nameKey: r.name_key,
        patientName: r.patient_name,
        carerName: r.carer_name,
        relationship: r.relationship,
        nextAppointmentRaw: r.next_appointment_raw,
        nextAppointmentOn: r.next_appointment_on,
        treatment: r.treatment,
        address: r.address,
        lafFlag: r.laf_flag,
        phone: r.phone,
        firstSeenOn: r.first_seen_on,
        lastSeenOn: r.last_seen_on,
        daysSeen: r.days_seen,
        offSheetAt: r.off_sheet_at,
      }));

      const now = new Date().toISOString();
      const plan = reconcileRoster({ tabDate: tab.date!, roster: parsed.rows, db, now });
      const errors: string[] = [...parsed.problems];

      // ---- write the sheet's side ----
      const toMatch: ToMatch[] = [];
      if (plan.inserts.length > 0) {
        const { data: inserted, error } = await admin.schema("ops").from("house_sheet_people").insert(plan.inserts).select("id, patient_name, carer_name, relationship");
        if (error) errors.push(`insert ${plan.inserts.length} row(s): ${error.message}`);
        for (const r of (inserted ?? []) as { id: string; patient_name: string; carer_name: string | null; relationship: string | null }[]) {
          toMatch.push({ id: r.id, patientName: r.patient_name, carerName: r.carer_name, relationship: r.relationship });
        }
      }
      for (const u of plan.updates) {
        const { error } = await admin.schema("ops").from("house_sheet_people").update(u.patch).eq("id", u.id);
        if (error) errors.push(`update ${u.id}: ${error.message}`);
      }
      if (plan.offSheet.length > 0) {
        const { error } = await admin.schema("ops").from("house_sheet_people").update({ off_sheet_at: now }).in("id", plan.offSheet);
        if (error) errors.push(`off-sheet ${plan.offSheet.length} row(s): ${error.message}`);
      }

      // ---- match: new rows, plus rows the model failed on earlier ----
      const { data: retry } = await admin
        .schema("ops")
        .from("house_sheet_people")
        .select("id, patient_name, carer_name, relationship")
        .eq("match_status", "unmatched")
        .not("ai_error", "is", null)
        .lt("ai_attempts", AI_MAX_ATTEMPTS)
        .is("reviewed_at", null);
      for (const r of (retry ?? []) as { id: string; patient_name: string; carer_name: string | null; relationship: string | null }[]) {
        if (!toMatch.some((t) => t.id === r.id)) toMatch.push({ id: r.id, patientName: r.patient_name, carerName: r.carer_name, relationship: r.relationship });
      }
      const counts = await matchPeople(toMatch, errors);

      // ---- the night's roster, and the day's headcount for the dashboards and DSWD figures ----
      try {
        await saveNights(tab.date!, parsed.rows);
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
      {
        const { error } = await admin.schema("ops").from("census_snapshots").upsert({ date: tab.date, in_house: parsed.rows.length }, { onConflict: "date" });
        if (error) errors.push(`census ${tab.date}: ${error.message}`);
      }

      const modelProblems = errors.filter((e) => e.startsWith("model on "));
      const hardErrors = errors.filter((e) => !e.startsWith("model on "));
      await finish({
        status: hardErrors.length === 0 ? "success" : "failed",
        csv_hash: hash,
        rows_seen: plan.counts.seen,
        inserted: plan.counts.inserted,
        updated: plan.counts.updated,
        off_sheet: plan.counts.offSheet,
        returned: plan.counts.returned,
        auto_matched: counts.autoMatched,
        suggested: counts.suggested,
        unmatched: counts.unmatched,
        ai_calls: counts.aiCalls,
        nights_saved: hardErrors.length === 0 ? parsed.rows.length : null,
        error: errors.length > 0 ? errors.join("\n").slice(0, 4000) : null,
      });
      if (hardErrors.length > 0) anyFailed = true;
      results.push({ tab: tab.name, status: hardErrors.length === 0 ? "success" : "failed", counts: { ...plan.counts, ...counts }, problems: [...hardErrors, ...modelProblems] });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await finish({ status: "failed", error: message.slice(0, 4000) });
      anyFailed = true;
      results.push({ tab: tab.name, status: "failed", error: message });
    }
  }

  // In-house children's next appointment follows the sheet (0051), so the
  // transport manifest needs no typing. Hand-made appointments are untouched.
  const { data: appointmentsChanged, error: apptError } = await admin.schema("ops").rpc("sync_sheet_appointments");
  if (apptError) anyFailed = true;

  return NextResponse.json({
    ok: !anyFailed,
    tabs: results,
    appointments: apptError ? { error: apptError.message } : { changed: appointmentsChanged },
  });
}
