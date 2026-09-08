import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { adjudicatePatientMatch, type MatchCandidate } from "@/lib/ai/openai";
import { openaiConfigured } from "@/lib/ai/env";
import { dayKey } from "@/lib/utils/dtr";
import {
  houseSheetCsvUrl,
  houseSheetHtmlUrl,
  indexPatients,
  matchDeterministic,
  parseRosterCsv,
  parseTabList,
  reconcileRoster,
  type DbSheetPerson,
  type PatientIndex,
  type PatientRef,
} from "@/lib/utils/house-sheet";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const RUNNING_GUARD_MS = 5 * 60_000;
const MAX_DAYS = 60;
const AI_CONCURRENCY = 3;
const AI_BUDGET_MS = 180_000;
const AI_MAX_ATTEMPTS = 3;
/** Below this the model's pick is shown as candidates, not as a suggestion. */
const SUGGEST_MIN_CONFIDENCE = 0.6;

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
    const { data: staff } = await session.schema("shared").from("staff").select("role, active").eq("id", user.id).single();
    if (!staff?.active || !["admin", "social_worker"].includes(staff.role)) {
      return NextResponse.json({ ok: false, error: "Only admins and social workers can check the house sheet." }, { status: 403 });
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
  const chosen = tabs.slice(0, days).reverse(); // oldest first, so a person's day count grows in order

  let index: PatientIndex | null = null;
  const loadIndex = async () => {
    if (index) return index;
    const { data, error } = await admin.schema("ops").from("patients").select("id, patient_number, first_name, last_name, birth_date, province:provinces(name), city:cities(name), carers(name)");
    if (error) throw new Error(error.message);
    type Row = {
      id: string;
      patient_number: string;
      first_name: string;
      last_name: string;
      birth_date: string | null;
      province: { name: string } | { name: string }[] | null;
      city: { name: string } | { name: string }[] | null;
      carers: { name: string }[] | null;
    };
    const one = (v: { name: string } | { name: string }[] | null) => (Array.isArray(v) ? (v[0]?.name ?? null) : (v?.name ?? null));
    const refs: PatientRef[] = ((data ?? []) as Row[]).map((r) => ({
      id: r.id,
      patientNumber: r.patient_number,
      firstName: r.first_name,
      lastName: r.last_name,
      birthDate: r.birth_date,
      province: one(r.province),
      city: one(r.city),
      carerNames: (r.carers ?? []).map((c) => c.name),
    }));
    index = indexPatients(refs);
    return index;
  };

  const aiDeadline = Date.now() + AI_BUDGET_MS;
  const results: Record<string, unknown>[] = [];
  let anyFailed = false;

  for (const tab of chosen) {
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
      const response = await fetch(houseSheetCsvUrl(tab.gid), { cache: "no-store", redirect: "follow", headers: { accept: "text/csv" } });
      const contentType = response.headers.get("content-type") ?? "";
      if (!response.ok || !contentType.includes("text/csv")) throw new Error(`Google returned ${response.status} ${contentType || "(no content type)"} for tab ${tab.name}.`);
      const csv = await response.text();
      const hash = createHash("sha256").update(csv).digest("hex");

      const { data: last } = await admin
        .schema("ops")
        .from("house_sheet_sync_runs")
        .select("csv_hash, rows_seen")
        .eq("tab_date", tab.date)
        .in("status", ["success", "unchanged"])
        .neq("id", runId)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!force && last?.csv_hash === hash) {
        await finish({ status: "unchanged", csv_hash: hash, rows_seen: last.rows_seen ?? 0 });
        results.push({ tab: tab.name, status: "unchanged" });
        continue;
      }

      const parsed = parseRosterCsv(csv);
      if (parsed.rows.length === 0 && parsed.problems.length > 0) throw new Error(parsed.problems[0]);
      if (parsed.rows.length === 0) {
        // Today's tab exists but nobody has filled it in yet: not "the house is empty".
        await finish({ status: "success", csv_hash: hash, rows_seen: 0 });
        results.push({ tab: tab.name, status: "success", counts: { seen: 0 }, problems: ["The tab has no names yet."] });
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
      const toMatch: { id: string; patientName: string; carerName: string | null; relationship: string | null }[] = [];
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

      const counts = { autoMatched: 0, suggested: 0, unmatched: 0, aiCalls: 0 };
      if (toMatch.length > 0) {
        const idx = await loadIndex();
        const aiQueue: { id: string; patientName: string; carerName: string | null; relationship: string | null; candidates: PatientRef[] }[] = [];
        for (const row of toMatch) {
          const m = matchDeterministic(row.patientName, idx);
          if (m.kind !== "candidates") {
            const { error } = await admin
              .schema("ops")
              .from("house_sheet_people")
              .update({ match_status: "auto_matched", matched_patient_id: m.patientId, match_method: m.kind, match_confidence: 1, ai_candidates: null, ai_reason: null, ai_error: null })
              .eq("id", row.id);
            if (error) errors.push(`match ${row.id}: ${error.message}`);
            else counts.autoMatched += 1;
          } else if (m.candidates.length === 0) {
            const { error } = await admin
              .schema("ops")
              .from("house_sheet_people")
              .update({ match_status: "unmatched", matched_patient_id: null, match_method: null, match_confidence: null, ai_candidates: [], ai_reason: "No similar name on file.", ai_error: null })
              .eq("id", row.id);
            if (error) errors.push(`match ${row.id}: ${error.message}`);
            else counts.unmatched += 1;
          } else {
            aiQueue.push({ ...row, candidates: m.candidates });
          }
        }

        const candidateJson = (cs: PatientRef[]) => cs.map((c) => ({ id: c.id, name: `${c.lastName}, ${c.firstName}`.replace(/\s+/g, " ").trim(), patientNumber: c.patientNumber }));
        const askOne = async (item: (typeof aiQueue)[number]) => {
          const base = { ai_candidates: candidateJson(item.candidates), matched_patient_id: null, match_method: null, match_confidence: null };
          if (!openaiConfigured()) {
            await admin.schema("ops").from("house_sheet_people").update({ ...base, match_status: "unmatched", ai_reason: null, ai_error: "OPENAI_API_KEY is not configured." }).eq("id", item.id);
            counts.unmatched += 1;
            return;
          }
          if (Date.now() > aiDeadline) {
            await admin.schema("ops").from("house_sheet_people").update({ ...base, match_status: "unmatched", ai_reason: null, ai_error: "Out of time this run; will retry." }).eq("id", item.id);
            counts.unmatched += 1;
            return;
          }
          const candidates: MatchCandidate[] = item.candidates.map((c) => ({
            id: c.id,
            name: `${c.lastName}, ${c.firstName}`.replace(/\s+/g, " ").trim(),
            carerNames: c.carerNames,
            birthYear: c.birthDate ? Number(c.birthDate.slice(0, 4)) : null,
            province: c.province,
          }));
          counts.aiCalls += 1;
          try {
            const a = await adjudicatePatientMatch({ sheetName: item.patientName, sheetCarer: item.carerName, sheetRelationship: item.relationship, candidates });
            const suggest = a.decision === "match" && a.patientId !== null && a.confidence >= SUGGEST_MIN_CONFIDENCE;
            const { error } = await admin
              .schema("ops")
              .from("house_sheet_people")
              .update({
                ...base,
                match_status: suggest ? "suggested" : "unmatched",
                matched_patient_id: suggest ? a.patientId : null,
                match_method: suggest ? "ai" : null,
                match_confidence: Math.round(a.confidence * 100) / 100,
                ai_reason: a.reason,
                ai_error: null,
                ai_attempts: AI_MAX_ATTEMPTS, // answered: no retry
              })
              .eq("id", item.id);
            if (error) errors.push(`ai ${item.id}: ${error.message}`);
            else if (suggest) counts.suggested += 1;
            else counts.unmatched += 1;
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const { data: cur } = await admin.schema("ops").from("house_sheet_people").select("ai_attempts").eq("id", item.id).maybeSingle();
            await admin
              .schema("ops")
              .from("house_sheet_people")
              .update({ ...base, match_status: "unmatched", ai_reason: null, ai_error: message.slice(0, 500), ai_attempts: ((cur?.ai_attempts as number | undefined) ?? 0) + 1 })
              .eq("id", item.id);
            counts.unmatched += 1;
            errors.push(`model on "${item.patientName}": ${message}`);
          }
        };
        for (let i = 0; i < aiQueue.length; i += AI_CONCURRENCY) {
          await Promise.all(aiQueue.slice(i, i + AI_CONCURRENCY).map(askOne));
        }
      }

      // ---- the day's headcount, for the dashboards and DSWD figures ----
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

  return NextResponse.json({ ok: !anyFailed, tabs: results });
}
