import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { dayKey } from "@/lib/utils/dtr";
import { normalizeTime, parseSheetCsv, reconcile, sheetCsvUrl, type DbSheetRow } from "@/lib/utils/calendar-sheet";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RUNNING_GUARD_MS = 5 * 60_000;
const INSERT_CHUNK = 50;
const REMOVE_CHUNK = 100;
const UPDATE_PARALLEL = 10;

/**
 * Pulls the master calendar's Google Sheet into ops.calendar_events.
 *
 * Called two ways: by pg_cron every two hours with a bearer secret (0034),
 * and by an admin's "Sync now" with their session. Exempt from the auth
 * middleware for the first, so it does its own checking here.
 *
 * All the deciding is in lib/utils/calendar-sheet.ts; this file only fetches,
 * reads, writes and records. Every run leaves a row in calendar_sync_runs,
 * even one that changed nothing -- that is how the calendar page can say
 * when it last looked and when something last happened.
 */
export async function POST(request: Request) {
  let body: { trigger?: unknown; force?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    // An empty body is fine; the cron sends one, a button need not.
  }
  const force = body.force === true;

  // ---- who is asking ----
  let trigger: "cron" | "manual";
  let triggeredBy: string | null = null;

  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (bearer !== undefined) {
    const expected = process.env.CALENDAR_SYNC_SECRET;
    if (!expected) {
      return NextResponse.json({ ok: false, error: "CALENDAR_SYNC_SECRET is not configured on the server." }, { status: 500 });
    }
    const a = Buffer.from(bearer);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return NextResponse.json({ ok: false, error: "Not authorised." }, { status: 401 });
    }
    trigger = "cron";
  } else {
    const session = await createClient();
    const {
      data: { user },
    } = await session.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
    const { data: staff } = await session.schema("shared").from("staff").select("role").eq("id", user.id).single();
    if (staff?.role !== "admin") return NextResponse.json({ ok: false, error: "Only admins can run a sync." }, { status: 403 });
    trigger = "manual";
    triggeredBy = user.id;
  }

  const admin = createAdminClient();

  // ---- is the arrangement still on ----
  const { data: settings } = await admin.schema("shared").from("app_settings").select("calendar_sheet_sync_enabled").eq("id", true).maybeSingle();
  if (settings && settings.calendar_sheet_sync_enabled === false) {
    return NextResponse.json({ ok: true, skipped: "disabled" });
  }

  // ---- one at a time ----
  const { data: running } = await admin
    .schema("ops")
    .from("calendar_sync_runs")
    .select("id")
    .eq("status", "running")
    .gte("started_at", new Date(Date.now() - RUNNING_GUARD_MS).toISOString())
    .limit(1);
  if (running && running.length > 0) {
    return NextResponse.json({ ok: false, error: "A sync is already running." }, { status: 409 });
  }

  const { data: run, error: runError } = await admin
    .schema("ops")
    .from("calendar_sync_runs")
    .insert({ trigger, triggered_by: triggeredBy })
    .select("id")
    .single();
  if (runError || !run) {
    return NextResponse.json({ ok: false, error: runError?.message ?? "Could not record the run." }, { status: 500 });
  }
  const runId = run.id as string;

  const finish = async (fields: Record<string, unknown>) => {
    await admin.schema("ops").from("calendar_sync_runs").update({ ...fields, finished_at: new Date().toISOString() }).eq("id", runId);
  };

  try {
    // ---- fetch ----
    const response = await fetch(sheetCsvUrl(), { cache: "no-store", redirect: "follow", headers: { accept: "text/csv" } });
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || !contentType.includes("text/csv")) {
      throw new Error(`Google returned ${response.status} ${contentType || "(no content type)"} — is the sheet still shared as "anyone with the link"?`);
    }
    const csv = await response.text();
    const hash = createHash("sha256").update(csv).digest("hex");

    // ---- unchanged since last time? ----
    const { data: last } = await admin
      .schema("ops")
      .from("calendar_sync_runs")
      .select("csv_hash, rows_seen")
      .in("status", ["success", "unchanged"])
      .neq("id", runId)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!force && last?.csv_hash === hash) {
      await finish({ status: "unchanged", csv_hash: hash, rows_seen: last.rows_seen ?? 0 });
      return NextResponse.json({ ok: true, runId, status: "unchanged" });
    }

    // ---- read ----
    const parsed = parseSheetCsv(csv);
    if (parsed.events.length === 0) {
      throw new Error(parsed.problems[0] ?? "The sheet had no events in it.");
    }

    const { data: dbRows, error: dbError } = await admin
      .schema("ops")
      .from("calendar_events")
      .select("id, source, date, time, time_key, title, venue, officer_on_duty, staff_needed, booked_by, contact_info, remarks, is_holiday, sheet_key, sheet_removed_at");
    if (dbError) throw new Error(dbError.message);

    type Row = {
      id: string;
      source: "app" | "sheet";
      date: string;
      time: string | null;
      time_key: string | null;
      title: string;
      venue: string | null;
      officer_on_duty: string | null;
      staff_needed: string | null;
      booked_by: string | null;
      contact_info: string | null;
      remarks: string | null;
      is_holiday: boolean;
      sheet_key: string | null;
      sheet_removed_at: string | null;
    };
    const rows = (dbRows ?? []) as Row[];
    const dbSheet: DbSheetRow[] = rows
      .filter((r) => r.source === "sheet")
      .map((r) => ({
        id: r.id,
        date: r.date,
        time: r.time,
        timeKey: r.time_key ?? normalizeTime(r.time),
        title: r.title,
        venue: r.venue,
        officerOnDuty: r.officer_on_duty,
        staffNeeded: r.staff_needed,
        bookedBy: r.booked_by,
        contactInfo: r.contact_info,
        remarks: r.remarks,
        isHoliday: r.is_holiday,
        sheetKey: r.sheet_key,
        sheetRemovedAt: r.sheet_removed_at,
      }));
    const appKeys = new Set(
      rows.filter((r) => r.source === "app").map((r) => `${r.date}|${r.title.replace(/\s+/g, " ").trim().toLowerCase()}|${normalizeTime(r.time)}`)
    );

    const now = new Date().toISOString();
    const plan = reconcile({ sheet: parsed.events, dbSheet, appKeys, today: dayKey(new Date()), now });

    // ---- write ----
    const errors: string[] = [];

    for (let i = 0; i < plan.inserts.length; i += INSERT_CHUNK) {
      const chunk = plan.inserts.slice(i, i + INSERT_CHUNK);
      const { error } = await admin.schema("ops").from("calendar_events").insert(chunk);
      if (error) {
        // A chunk is all-or-nothing; find the rows that actually fail.
        for (const row of chunk) {
          const { error: one } = await admin.schema("ops").from("calendar_events").insert(row);
          if (one) errors.push(`${row.date} "${row.title}": ${one.message}`);
        }
      }
    }

    for (let i = 0; i < plan.updates.length; i += UPDATE_PARALLEL) {
      const batch = plan.updates.slice(i, i + UPDATE_PARALLEL);
      const results = await Promise.all(batch.map((u) => admin.schema("ops").from("calendar_events").update(u.patch).eq("id", u.id)));
      results.forEach((r, j) => {
        if (r.error) errors.push(`update ${batch[j].id}: ${r.error.message}`);
      });
    }

    for (let i = 0; i < plan.removes.length; i += REMOVE_CHUNK) {
      const ids = plan.removes.slice(i, i + REMOVE_CHUNK);
      const { error } = await admin.schema("ops").from("calendar_events").update({ sheet_removed_at: now, updated_by: null }).in("id", ids);
      if (error) errors.push(`hide ${ids.length} row(s): ${error.message}`);
    }

    const counts = { ...plan.counts, duplicates: parsed.duplicates };
    const problems = [...parsed.problems, ...errors];
    await finish({
      status: errors.length === 0 ? "success" : "failed",
      csv_hash: hash,
      rows_seen: counts.seen,
      inserted: counts.inserted,
      updated: counts.updated,
      removed: counts.removed,
      restored: counts.restored,
      collisions: counts.collisions,
      duplicates: counts.duplicates,
      error: problems.length > 0 ? problems.join("\n").slice(0, 4000) : null,
    });

    return NextResponse.json({ ok: errors.length === 0, runId, status: errors.length === 0 ? "success" : "failed", counts, problems });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finish({ status: "failed", error: message.slice(0, 4000) });
    return NextResponse.json({ ok: false, runId, error: message }, { status: 500 });
  }
}
