import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { draftMonthDrivers, suggestExpensePurposes, type DriversExample } from "@/lib/ai/openai";
import { openaiConfigured } from "@/lib/ai/env";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { maskNames, monthsCovered, sharesPhrase, tidyName } from "@/lib/utils/finance-summary";

export type DraftResult = { ok: true; drivers: string; saved: boolean } | { ok: false; error: string };
export type PurposesResult = { ok: true; suggested: number } | { ok: false; error: string };

const NOT_SET_UP = "AI drafting is not set up on this site: OPENAI_API_KEY is missing on the hosting.";

/** Null, an empty list or object, or an object whose numbers are all zero (no payroll, no vehicle costs, no activity). */
function isEmptyFact(v: unknown): boolean {
  if (v === null || v === undefined || v === 0 || v === "0") return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") {
    const values = Object.values(v as Record<string, unknown>);
    return values.length === 0 || values.every((x) => x === null || x === 0 || x === "0" || (typeof x === "object" && isEmptyFact(x)));
  }
  return false;
}

/** Every staff member's first and last name: masked out of bank text before it reaches the model. */
async function staffNames(admin: SupabaseClient): Promise<string[]> {
  const { data } = await admin.schema("shared").from("staff").select("first_name, last_name");
  return (data ?? []).flatMap((r) => [r.first_name as string, r.last_name as string]).filter(Boolean);
}

/** The month's facts with the empty ones dropped (cut at the end of `through` when given), or null when neither a statement nor a tracker deposit covers it. */
async function factsFor(admin: SupabaseClient, month: string, through?: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await admin.schema("ops").rpc("month_driver_facts", { p_month: month, ...(through ? { p_through: through } : {}) });
  if (error) throw new Error(error.message);
  const f = data as Record<string, unknown> | null;
  if (!f?.totals) return null;
  for (const key of Object.keys(f)) if (isEmptyFact(f[key])) delete f[key];
  // Donor names as the note writes them, not as the tracker typed them.
  const tidyList = (list: unknown) => {
    if (Array.isArray(list)) for (const g of list as { donor?: unknown }[]) if (typeof g?.donor === "string") g.donor = tidyName(g.donor);
  };
  tidyList(f.cash_gifts_by_donor);
  tidyList(f.largest_credits);
  tidyList((f.in_kind as { top_donors?: unknown } | undefined)?.top_donors);
  const names = await staffNames(admin);
  if (Array.isArray(f.largest_debits)) for (const d of f.largest_debits as { bank_text?: unknown }[]) if (typeof d.bank_text === "string") d.bank_text = maskNames(d.bank_text, names);
  return f;
}

/**
 * The month's facts -> the model -> the row's draft (0113, 0114). Runs as the service role: the
 * caller's right to ask is checked by whoever calls this. `save: false` returns the text only.
 */
export async function draftDriversFor(admin: SupabaseClient, month: string, { save, through }: { save: boolean; through?: string }): Promise<DraftResult> {
  if (!openaiConfigured()) return { ok: false, error: NOT_SET_UP };
  // A saved draft explains spending by purpose: the month's untagged debits get their suggestion first.
  if (save) await suggestPurposesFor(admin, month).catch(() => undefined);
  let facts: Record<string, unknown> | null;
  try {
    facts = await factsFor(admin, month, through);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (!facts) return { ok: false, error: "Nothing covers this month yet: no bank statement and no deposit on the Donation Tracker." };

  // The two confirmed months nearest this one, with their facts: the model learns the CEO's mapping from data to note.
  const { data: confirmed } = await admin.schema("ops").from("finance_month_notes").select("month, drivers").not("confirmed_at", "is", null).neq("drivers", "").neq("month", month);
  const nearest = (confirmed ?? [])
    .map((r) => ({ month: r.month as string, note: r.drivers as string }))
    .sort((a, b) => Math.abs(monthIndex(a.month) - monthIndex(month)) - Math.abs(monthIndex(b.month) - monthIndex(month)))
    .slice(0, 2);
  const examples: DriversExample[] = [];
  for (const n of nearest) {
    const f = await factsFor(admin, n.month).catch(() => null);
    if (f) examples.push({ facts: f, note: n.note });
  }

  let drivers: string;
  try {
    drivers = await draftMonthDrivers(facts, examples);
    // A draft that lifts a phrase from an earlier month's note has copied its causes: draft again without the examples.
    if (examples.some((e) => sharesPhrase(drivers, e.note))) drivers = await draftMonthDrivers(facts, []);
  } catch (e) {
    return { ok: false, error: `The model did not answer: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!drivers) return { ok: false, error: "The model returned an empty note." };
  if (save) {
    const { error: saveError } = await admin.schema("ops").from("finance_month_notes").upsert({ month, draft: drivers, draft_at: new Date().toISOString() }, { onConflict: "month" });
    if (saveError) return { ok: false, error: saveError.message };
  }
  return { ok: true, drivers, saved: save };
}

const monthIndex = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7));

/** A suggested purpose for every debit of the month that has none yet (0114); confirmed ones are never touched. */
export async function suggestPurposesFor(admin: SupabaseClient, month: string): Promise<PurposesResult> {
  if (!openaiConfigured()) return { ok: false, error: NOT_SET_UP };
  const start = `${month}-01`;
  const next = monthIndex(month) % 12 === 0 ? `${Number(month.slice(0, 4)) + 1}-01-01` : `${month.slice(0, 4)}-${String(Number(month.slice(5, 7)) + 1).padStart(2, "0")}-01`;
  const [{ data: rows, error }, { data: settings }] = await Promise.all([
    admin.schema("ops").from("bank_transactions").select("id, posting_date, debit, description, memo").gt("debit", 0).is("purpose", null).gte("posting_date", start).lt("posting_date", next),
    admin.schema("shared").from("app_settings").select("exec_summary").eq("id", true).maybeSingle(),
  ]);
  if (error) return { ok: false, error: error.message };
  const purposes = ((settings?.exec_summary as { purposes?: string[] } | null)?.purposes ?? []).filter((p) => typeof p === "string" && p.trim());
  if (!rows?.length) return { ok: true, suggested: 0 };
  const names = await staffNames(admin);
  let answers: { id: string; purpose: string }[];
  try {
    answers = await suggestExpensePurposes(
      rows.map((r) => ({ id: r.id as string, date: r.posting_date as string, amount: Number(r.debit), bankText: maskNames([r.description, r.memo].filter(Boolean).join(" · "), names).slice(0, 120) })),
      purposes
    );
  } catch (e) {
    return { ok: false, error: `The model did not answer: ${e instanceof Error ? e.message : String(e)}` };
  }
  for (const a of answers) {
    await admin.schema("ops").from("bank_transactions").update({ purpose: a.purpose }).eq("id", a.id).is("purpose", null);
  }
  return { ok: true, suggested: answers.length };
}

/**
 * The nightly note (0121, pg_cron at 1:00 AM Manila): yesterday's month is drafted again on the
 * facts up to the end of yesterday, so the running month's note is the month to date and the
 * 1st of the month closes the month before. Earlier months of the last year that have figures but
 * no note at all get their first draft too (at most three a night). Best effort per month.
 */
export async function draftNightly(admin: SupabaseClient, now = new Date()): Promise<{ month: string; results: Record<string, string> }> {
  const yesterday = new Date(now.getTime() + 8 * 3_600_000 - 86_400_000).toISOString().slice(0, 10); // Manila (UTC+8), a day back
  const month = yesterday.slice(0, 7);
  const results: Record<string, string> = {};
  const first = await draftDriversFor(admin, month, { save: true, through: yesterday });
  results[month] = first.ok ? "drafted" : first.error;

  const from = `${Number(month.slice(0, 4)) - 1}${month.slice(4)}`;
  const [{ data: notes }, bank, deposits] = await Promise.all([
    admin.schema("ops").from("finance_month_notes").select("month, drivers, draft").gte("month", from),
    fetchAll<{ posting_date: string }>((a, b) => admin.schema("ops").from("bank_transactions").select("posting_date").gte("posting_date", `${from}-01`).lt("posting_date", `${month}-01`).order("id").range(a, b)),
    fetchAll<{ deposit_date: string }>((a, b) => admin.schema("ops").from("cash_deposits").select("deposit_date").gte("deposit_date", `${from}-01`).lt("deposit_date", `${month}-01`).order("id").range(a, b)),
  ]);
  const noted = new Set((notes ?? []).filter((n) => n.drivers || n.draft).map((n) => n.month as string));
  const withFigures = new Set([...bank.map((r) => r.posting_date.slice(0, 7)), ...deposits.map((r) => r.deposit_date.slice(0, 7))]);
  for (const m of [...withFigures].filter((m) => !noted.has(m)).sort().reverse().slice(0, 3)) {
    const r = await draftDriversFor(admin, m, { save: true });
    results[m] = r.ok ? "drafted" : r.error;
  }
  return { month, results };
}

/** After a statement import: purposes for the new debits, then a draft, for every month it touched (the first three). Best effort. */
export async function draftAfterImport(admin: SupabaseClient, coversFrom: string, coversTo: string): Promise<void> {
  for (const month of monthsCovered(coversFrom, coversTo)) {
    await draftDriversFor(admin, month, { save: true }).catch(() => undefined);
  }
}
