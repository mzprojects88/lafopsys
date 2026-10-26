import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { draftAfterImport } from "@/lib/finance/month-drivers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { categorize, checkContinuity, naturalKey, parseBankCsv, parseCsv, summarizeBatch } from "@/lib/utils/bank-statement";
import { houseSheetCsvUrl, houseSheetHtmlUrl, parseTabList } from "@/lib/utils/house-sheet";
import { TRACKER_SHEET_ID, TRACKER_YEAR, cashLinesFromTab, depositsFromTab } from "@/lib/utils/tracker-cash";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const RUNNING_GUARD_MS = 5 * 60_000;
const CHUNK = 200;

/**
 * The 2026 LAF Donation Tracker into the app (0110), every half hour by pg_cron (bearer
 * CALENDAR_SYNC_SECRET) or "Check now" by a donors editor:
 *  - CASH tab -> ops.receive_cash_lines('2026') (0084: replace-whole, posts gifts of confirmed names),
 *    then every posted gift without a receipt gets its LAF-CSH AR -- until Settings sets
 *    cash_from_app_since, from when gifts are entered in Donors > New cash gift instead.
 *  - BDO_CASH DONATIONS tab -> ops.cash_deposits (this year's deposits, with the slip links).
 *  - Bank Statement tab -> Finance > Bank Import's tables, rows not imported yet only (an upload of
 *    the same statement wins: same natural key = skipped).
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
    const { data: canEdit } = await session.schema("shared").rpc("module_editable", { p_module: "donors" });
    if (canEdit !== true) return NextResponse.json({ ok: false, error: "Your access to Donors is view only." }, { status: 403 });
    trigger = "manual";
    triggeredBy = userData.user.id;
  }

  const admin = createAdminClient();
  const { data: settings } = await admin.schema("shared").from("app_settings").select("cash_from_app_since").eq("id", true).maybeSingle();
  const cashFromApp = (settings?.cash_from_app_since as string | null | undefined) ?? null;
  const { data: running } = await admin
    .schema("ops")
    .from("tracker_sync_runs")
    .select("id")
    .eq("status", "running")
    .gte("started_at", new Date(Date.now() - RUNNING_GUARD_MS).toISOString())
    .limit(1);
  if (running && running.length > 0) return NextResponse.json({ ok: false, error: "A check is already running." }, { status: 409 });

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
  let tabs;
  try {
    const page = await fetch(houseSheetHtmlUrl(TRACKER_SHEET_ID), { cache: "no-store", redirect: "follow" });
    if (!page.ok) throw new Error(`Google returned ${page.status} for the Donation Tracker — is it still shared as "anyone with the link"?`);
    tabs = parseTabList(await page.text());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await admin.schema("ops").from("tracker_sync_runs").insert({ trigger, triggered_by: triggeredBy, tab: "(tab list)", status: "failed", finished_at: new Date().toISOString(), error: message.slice(0, 4000) });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
  const tabNamed = (want: string) => tabs.find((t) => t.name.replace(/\s+/g, " ").trim().toLowerCase() === want);

  const results: Record<string, unknown>[] = [];
  let anyFailed = false;
  const readTab = async (name: string, gid: string, work: (csv: string) => Promise<{ seen: number; written: number; errors: string[] }>) => {
    let csv: string;
    try {
      const res = await fetch(houseSheetCsvUrl(gid, TRACKER_SHEET_ID), { cache: "no-store", redirect: "follow", headers: { accept: "text/csv" } });
      if (!res.ok || !(res.headers.get("content-type") ?? "").includes("text/csv")) throw new Error(`Google returned ${res.status} for tab ${name}.`);
      csv = await res.text();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await admin.schema("ops").from("tracker_sync_runs").insert({ trigger, triggered_by: triggeredBy, tab: name, status: "failed", finished_at: new Date().toISOString(), error: message.slice(0, 4000) });
      anyFailed = true;
      results.push({ tab: name, status: "failed", error: message });
      return;
    }
    const hash = createHash("sha256").update(csv).digest("hex");
    const { data: last } = await admin.schema("ops").from("tracker_sync_runs").select("csv_hash").eq("tab", name).eq("status", "success").order("started_at", { ascending: false }).limit(1).maybeSingle();
    if (!force && last?.csv_hash === hash) return; // unchanged: no run row
    const { data: run } = await admin.schema("ops").from("tracker_sync_runs").insert({ trigger, triggered_by: triggeredBy, tab: name }).select("id").single();
    try {
      const r = await work(csv);
      await admin
        .schema("ops")
        .from("tracker_sync_runs")
        .update({ status: "success", finished_at: new Date().toISOString(), csv_hash: hash, rows_seen: r.seen, written: r.written, error: r.errors.join("\n").slice(0, 4000) || null })
        .eq("id", run!.id);
      results.push({ tab: name, status: "success", seen: r.seen, written: r.written, problems: r.errors.length });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await admin.schema("ops").from("tracker_sync_runs").update({ status: "failed", finished_at: new Date().toISOString(), error: message.slice(0, 4000) }).eq("id", run!.id);
      anyFailed = true;
      results.push({ tab: name, status: "failed", error: message });
    }
  };

  const cash = tabNamed("cash");
  if (cash && !cashFromApp) {
    await readTab(cash.name, cash.gid, async (csv) => {
      const read = cashLinesFromTab(parseCsv(csv, true), today);
      if (!read.lines.length) throw new Error("No readable cash rows; nothing changed.");
      const { data, error } = await admin.schema("ops").rpc("receive_cash_lines", { p_source: String(TRACKER_YEAR), p_lines: read.lines, p_problems: read.problems });
      if (error) throw new Error(error.message);
      const status = (data as { status?: string; posted?: number } | null) ?? {};
      return { seen: read.lines.length, written: status.status === "received" ? read.lines.length : 0, errors: read.problems };
    });
  }

  const bdo = tabNamed("bdo_cash donations");
  if (bdo) {
    await readTab(bdo.name, bdo.gid, async (csv) => {
      const read = depositsFromTab(parseCsv(csv, true), today);
      if (!read.lines.length) throw new Error("No readable deposits; nothing changed.");
      const { error } = await admin.schema("ops").rpc("receive_cash_deposits", { p_year: TRACKER_YEAR, p_lines: read.lines });
      if (error) throw new Error(error.message);
      return { seen: read.lines.length, written: read.lines.length, errors: read.problems };
    });
  }

  const bank = tabNamed("bank statement");
  if (bank) {
    await readTab(bank.name, bank.gid, async (csv) => importBankRows(admin, csv, triggeredBy));
  }

  // Every posted cash gift without a receipt gets its LAF-CSH number -- on every run, so names confirmed
  // on Donors > Cash gifts between reads are receipted by the next run, changed sheet or not.
  const receipts = await issueReceipts(admin);
  // The unambiguous links gift <-> deposit <-> bank credit (0111); the rest wait on Finance > Approvals.
  const { data: reconciled, error: reconcileError } = await admin.schema("ops").rpc("auto_reconcile_cash");
  return NextResponse.json({ ok: !anyFailed, tabs: results, receipts, reconciled: reconcileError ? { error: reconcileError.message } : reconciled });
}

/** Every posted cash gift without a receipt gets its LAF-CSH number (0110). */
async function issueReceipts(admin: SupabaseClient): Promise<{ issued: number; error?: string }> {
  const { data, error } = await admin.schema("ops").rpc("issue_cash_ars_for_unreceipted");
  return error ? { issued: 0, error: `receipts: ${error.message}` } : { issued: Number(data ?? 0) };
}

/** The Bank Statement tab's rows into Finance > Bank Import, exactly as an upload would, skipping rows already there. */
async function importBankRows(admin: SupabaseClient, csv: string, importedBy: string | null) {
  const parsed = parseBankCsv(csv);
  const errors = parsed.problems.map((p) => `Line ${p.line}: ${p.message}`);
  if (!parsed.rows.length) return { seen: 0, written: 0, errors };
  const { data: account, error: accountError } = await admin.schema("ops").from("accounts").select("id").order("created_at").limit(1).maybeSingle();
  if (accountError || !account) throw new Error(accountError?.message ?? "No bank account is set up in Finance.");
  const accountId = account.id as string;
  const summary = summarizeBatch(parsed.rows)!;
  const { data: existing, error: existingError } = await admin
    .schema("ops")
    .from("bank_transactions")
    .select("posting_date, description, debit, credit, running_balance")
    .eq("account_id", accountId)
    .gte("posting_date", summary.coversFrom)
    .lte("posting_date", summary.coversTo);
  if (existingError) throw new Error(existingError.message);
  const keys = new Set((existing ?? []).map((r) => naturalKey({ postingDate: r.posting_date, description: r.description, debit: Number(r.debit), credit: Number(r.credit), runningBalance: Number(r.running_balance) }, accountId)));
  const fresh = parsed.rows.filter((r) => !keys.has(naturalKey(r, accountId)));
  if (!fresh.length) return { seen: parsed.rows.length, written: 0, errors };
  const { data: prior } = await admin.schema("ops").from("bank_transactions").select("running_balance").eq("account_id", accountId).lt("posting_date", summary.coversFrom).order("posting_date", { ascending: false }).order("row_seq", { ascending: false }).limit(1);
  const opening = prior?.[0] ? Number(prior[0].running_balance) : null;
  const warnings = checkContinuity(parsed.rows, opening);
  const { data: batch, error: batchError } = await admin
    .schema("ops")
    .from("bank_statement_imports")
    .insert({
      account_id: accountId,
      file_name: "Donation Tracker — Bank Statement tab",
      source: "csv_upload",
      covers_from: summary.coversFrom,
      covers_to: summary.coversTo,
      opening_balance: opening ?? summary.impliedOpening,
      closing_balance: summary.closing,
      row_count: parsed.rows.length,
      inserted_count: fresh.length,
      skipped_count: parsed.rows.length - fresh.length,
      continuity_warnings: warnings.length,
      imported_by: importedBy,
    })
    .select("id")
    .single();
  if (batchError) throw new Error(batchError.message);
  const payload = fresh.map((r) => ({
    account_id: accountId,
    import_id: batch.id,
    row_seq: r.rowSeq,
    posting_date: r.postingDate,
    branch: r.branch,
    description: r.description,
    debit: r.debit,
    credit: r.credit,
    running_balance: r.runningBalance,
    check_number: r.checkNumber,
    memo: r.memo,
    category: categorize(r.description),
    needs_review: r.debit === 0 && r.credit === 0,
    review_reason: r.debit === 0 && r.credit === 0 ? "Amount missing in statement export" : null,
  }));
  for (let i = 0; i < payload.length; i += CHUNK) {
    const { error } = await admin.schema("ops").from("bank_transactions").insert(payload.slice(i, i + CHUNK));
    if (error) throw new Error(`Imported ${i} of ${payload.length} new rows, then: ${error.message}`);
  }
  // The months these lines touched get a fresh draft of their Key monthly drivers (0113), after the reply.
  after(() => draftAfterImport(admin, summary.coversFrom, summary.coversTo));
  return { seen: parsed.rows.length, written: fresh.length, errors };
}
