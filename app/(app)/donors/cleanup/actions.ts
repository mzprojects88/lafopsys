"use server";

import { createClient } from "@/lib/supabase/server";
import { openaiConfigured } from "@/lib/ai/env";
import { judgeDonorPairs, reviewDonorNames, type DonorNameAnswer } from "@/lib/ai/openai";
import { formatDonorName } from "@/lib/utils/donor-format";
import { duplicateDonors } from "@/lib/utils/donor-details";

export type FindResult = { ok: true; added: { format: number; merge: number; incomplete: number }; ai: boolean; aiError?: string } | { ok: false; error: string };

interface DonorRow {
  id: string;
  name: string;
  type: string;
  salutation: string | null;
  gift_count: number;
  created_at: string;
}

/**
 * Looks over every donor and records suggestions for a donors editor to approve (0083): names in
 * LAF's style, the right donor type, full names for one-word entries, and duplicates to merge.
 * Rules first; the AI (names and types only, nothing else) settles what rules can't. Runs as the
 * signed-in editor, so the database's own rules decide what may be written.
 */
export async function findDonorSuggestions(): Promise<FindResult> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: "Not signed in." };
  const { data: canEdit } = await supabase.schema("shared").rpc("module_editable", { p_module: "donors" });
  if (!canEdit) return { ok: false, error: "Only donors editors can look for clean-ups." };

  const [{ data: donorRows, error: e1 }, { data: open, error: e2 }] = await Promise.all([
    supabase.schema("ops").from("donors").select("id, name, type, salutation, gift_count, created_at"),
    supabase.schema("ops").from("donor_suggestions").select("donor_id, kind, proposed").eq("status", "pending"),
  ]);
  if (e1 || e2) return { ok: false, error: (e1 ?? e2)!.message };
  const donors = (donorRows ?? []) as DonorRow[];
  const pending = new Set((open ?? []).map((s) => `${s.donor_id}|${s.kind}|${(s.proposed as { merge?: string })?.merge ?? ""}`));
  const rows: { donor_id: string; kind: string; proposed: Record<string, unknown>; reason: string; source: "rule" | "ai" }[] = [];
  const add = (r: (typeof rows)[number]) => {
    const key = `${r.donor_id}|${r.kind}|${(r.proposed.merge as string) ?? ""}`;
    if (!pending.has(key)) {
      pending.add(key);
      rows.push(r);
    }
  };

  // ---- names and types: rules, then the AI ----
  let ai: Map<string, DonorNameAnswer> = new Map();
  let aiError: string | undefined;
  const useAi = openaiConfigured();
  if (useAi) {
    try {
      for (let i = 0; i < donors.length; i += 60) {
        const answers = await reviewDonorNames(donors.slice(i, i + 60).map((d) => ({ id: d.id, name: d.name, type: d.type })));
        for (const a of answers) ai.set(a.id, a);
      }
    } catch (e) {
      aiError = e instanceof Error ? e.message : "The AI didn't answer.";
      ai = new Map();
    }
  }
  for (const d of donors) {
    if (d.type === "anonymous") continue;
    const rule = formatDonorName(d.name);
    const a = ai.get(d.id);
    // The AI decides person vs organisation and catches what rules can't; rules keep it honest.
    const name = a?.name || rule.name;
    const salutation = a?.salutation ?? rule.salutation;
    const type = a?.type ?? rule.suggestedType;
    // Either one noticing a first-name-only entry is enough (the AI isn't consistent about it).
    const incomplete = (a?.incomplete ?? false) || rule.incomplete;
    const fromAi = !!a && (a.name !== rule.name || a.type !== rule.suggestedType || (a.salutation ?? null) !== (rule.salutation ?? null));
    if (incomplete) {
      add({ donor_id: d.id, kind: "incomplete", proposed: { name, salutation }, reason: "Only a first name or nickname: add the donor's full name.", source: a ? "ai" : "rule" });
    } else if (name !== d.name || type !== d.type || (salutation ?? null) !== (d.salutation ?? null)) {
      const why = [name !== d.name ? "name style" : "", type !== d.type ? `type: ${d.type} → ${type}` : "", salutation && salutation !== d.salutation ? `title "${salutation}" kept apart` : ""].filter(Boolean).join("; ");
      add({ donor_id: d.id, kind: "format", proposed: { name, salutation, type }, reason: fromAi && a?.note ? `${why}. AI: ${a.note}` : why, source: fromAi ? "ai" : "rule" });
    }
  }

  // ---- duplicates: sure ones by rule, near ones judged by the AI ----
  const keepFirst = (a: DonorRow, b: DonorRow) => b.gift_count - a.gift_count || a.created_at.localeCompare(b.created_at);
  const { sure, maybe } = duplicateDonors(donors);
  for (const group of sure) {
    const [keep, ...rest] = [...group].sort(keepFirst);
    for (const other of rest) add({ donor_id: keep!.id, kind: "merge", proposed: { merge: other.id }, reason: `"${other.name}" is the same name written differently.`, source: "rule" });
  }
  if (useAi && maybe.length) {
    try {
      const answers = await judgeDonorPairs(maybe.map(([x, y], i) => ({ id: String(i), a: x.name, b: y.name })));
      for (const ans of answers) {
        if (ans.same === "no") continue;
        const [keep, other] = [...maybe[Number(ans.id)]!].sort(keepFirst);
        add({ donor_id: keep!.id, kind: "merge", proposed: { merge: other!.id }, reason: `"${other!.name}"? AI (${ans.same === "yes" ? "same donor" : "not sure"}): ${ans.reason}`, source: "ai" });
      }
    } catch (e) {
      aiError ??= e instanceof Error ? e.message : "The AI didn't answer.";
    }
  }

  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabase.schema("ops").from("donor_suggestions").insert(rows.slice(i, i + 200));
    if (error) return { ok: false, error: error.message };
  }
  const count = (k: string) => rows.filter((r) => r.kind === k).length;
  return { ok: true, added: { format: count("format"), merge: count("merge"), incomplete: count("incomplete") }, ai: useAi && !aiError, aiError };
}
