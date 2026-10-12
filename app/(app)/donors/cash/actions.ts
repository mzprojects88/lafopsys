"use server";

import { createClient } from "@/lib/supabase/server";
import { openaiConfigured } from "@/lib/ai/env";
import { reviewDonorNames } from "@/lib/ai/openai";
import { typeFromKeywords } from "@/lib/utils/donor-format";

export type CheckResult = { ok: true; checked: number } | { ok: false; error: string };

/** One request to the AI holds 60 names; at most this many names a click (about a minute). */
const BATCH = 60;
const MAX_NAMES = 600;

/**
 * Asks the AI what kind of donor each unconfirmed sheet name is (a person, a company, a
 * nonprofit...) and whether it is only a first name, and keeps the answers as hints
 * (ops.sheet_name_hints, 0084). Only names with no clear word in them ("Inc.", "Church") and no
 * hint yet are asked; only the name goes to the AI, never amounts or contact details. The AI's
 * own spelling of a name is not used anywhere: the rules write names. Runs as the signed-in
 * editor, so the database's own rules decide what may be written.
 */
export async function checkNamesWithAi(): Promise<CheckResult> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: "Not signed in." };
  const { data: canEdit } = await supabase.schema("shared").rpc("module_editable", { p_module: "donors" });
  if (!canEdit) return { ok: false, error: "Only donors editors can check names." };
  if (!openaiConfigured()) return { ok: false, error: "The AI is not set up on the server." };

  const ops = supabase.schema("ops");
  const [lines, decided, hinted] = await Promise.all([
    ops.from("cash_gift_lines").select("name_key, donor_name").order("name_key").limit(5000),
    ops.from("donor_sheet_names").select("name_key").limit(5000),
    ops.from("sheet_name_hints").select("name_key").limit(5000),
  ]);
  const failed = lines.error ?? decided.error ?? hinted.error;
  if (failed) return { ok: false, error: failed.message };

  const skip = new Set([...(decided.data ?? []), ...(hinted.data ?? [])].map((r) => r.name_key as string));
  const ask = new Map<string, string>();
  for (const l of lines.data ?? []) {
    const key = l.name_key as string;
    const name = l.donor_name as string;
    if (!skip.has(key) && !ask.has(key) && typeFromKeywords(name) === null) ask.set(key, name);
  }
  const items = [...ask].slice(0, MAX_NAMES).map(([id, name]) => ({ id, name, type: "individual" }));
  if (items.length === 0) return { ok: true, checked: 0 };

  let answers;
  try {
    const batches = [];
    for (let i = 0; i < items.length; i += BATCH) batches.push(items.slice(i, i + BATCH));
    answers = (await Promise.all(batches.map((b) => reviewDonorNames(b)))).flat();
  } catch (e) {
    return { ok: false, error: `The AI didn't answer (${e instanceof Error ? e.message : "no reply"}). Nothing changed; try again.` };
  }
  const rows = answers.filter((a) => ask.has(a.id)).map((a) => ({ name_key: a.id, type: a.type, incomplete: a.incomplete, note: a.note.slice(0, 300) }));
  if (rows.length) {
    const { error } = await ops.from("sheet_name_hints").upsert(rows, { onConflict: "name_key", ignoreDuplicates: true });
    if (error) return { ok: false, error: error.message };
  }
  return { ok: true, checked: rows.length };
}
