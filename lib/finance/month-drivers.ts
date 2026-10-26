import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { draftMonthDrivers } from "@/lib/ai/openai";
import { openaiConfigured } from "@/lib/ai/env";
import { monthsCovered } from "@/lib/utils/finance-summary";

export type DraftResult = { ok: true; drivers: string; saved: boolean } | { ok: false; error: string };

/** Null, an empty list or object, or an object whose numbers are all zero (no payroll, no vehicle costs, no activity). */
function isEmptyFact(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") {
    const values = Object.values(v as Record<string, unknown>);
    return values.length === 0 || values.every((x) => x === null || x === 0 || x === "0" || (typeof x === "object" && isEmptyFact(x)));
  }
  return false;
}

/**
 * The month's facts -> the model -> the row's draft (0113). Runs as the service role: the
 * caller's right to ask is checked by whoever calls this (the route checks the power; the
 * imports run for finance). `save: false` returns the text without touching the table.
 */
export async function draftDriversFor(admin: SupabaseClient, month: string, { save }: { save: boolean }): Promise<DraftResult> {
  if (!openaiConfigured()) return { ok: false, error: "AI drafting is not set up on this site: OPENAI_API_KEY is missing on the hosting." };
  const { data: facts, error } = await admin.schema("ops").rpc("month_driver_facts", { p_month: month });
  if (error) return { ok: false, error: error.message };
  const f = facts as Record<string, unknown> | null;
  if (!f?.totals) return { ok: false, error: "No bank statement covers this month yet. Upload it under Financial → Bank import." };
  // A fact that is zero or empty is left out, so the model has nothing to say "nil" about.
  for (const key of Object.keys(f)) if (isEmptyFact(f[key])) delete f[key];
  // The two latest confirmed paragraphs before this month set the voice.
  const { data: earlier } = await admin
    .schema("ops")
    .from("finance_month_notes")
    .select("drivers")
    .not("confirmed_at", "is", null)
    .neq("drivers", "")
    .lt("month", month)
    .order("month", { ascending: false })
    .limit(2);
  let drivers: string;
  try {
    drivers = await draftMonthDrivers(f, (earlier ?? []).map((r) => r.drivers as string));
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

/** After a statement import: a draft for every month it touched (the first three), best effort. */
export async function draftAfterImport(admin: SupabaseClient, coversFrom: string, coversTo: string): Promise<void> {
  for (const month of monthsCovered(coversFrom, coversTo)) {
    await draftDriversFor(admin, month, { save: true }).catch(() => undefined);
  }
}
