import type { SupabaseClient } from "@supabase/supabase-js";
import { adjudicatePatientMatch, type MatchCandidate } from "@/lib/ai/openai";
import { openaiConfigured } from "@/lib/ai/env";
import { indexPatients, matchDeterministic, type PatientIndex, type PatientRef } from "@/lib/utils/house-sheet";

const AI_CONCURRENCY = 3;
const AI_MAX_ATTEMPTS = 3;
/** Below this the model's pick is shown as candidates, not as a suggestion. */
const SUGGEST_MIN_CONFIDENCE = 0.6;

export type ToMatch = { id: string; patientName: string; carerName: string | null; relationship: string | null };

/**
 * Names on LAF's sheets resolved to patients (moved out of the House Sheet sync, 0046, so the LAF
 * Programs sync, 0103, matches the same way): the name rules first, then the model's suggestion
 * for a social worker to confirm on Patients > House Sheet. One matcher per run (one patient index,
 * one AI time budget). Server only: writes with the service role.
 */
export function createSheetMatcher(admin: SupabaseClient, aiBudgetMs: number) {
  let index: PatientIndex | null = null;
  const loadIndex = async () => {
    if (index) return index;
    const { data, error } = await admin.schema("ops").from("patients").select("id, patient_number, case_number, first_name, last_name, birth_date, province:provinces(name), city:cities(name), carers(name)");
    if (error) throw new Error(error.message);
    type Row = {
      id: string;
      patient_number: string | null;
      case_number: string | null;
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
      patientNumber: r.case_number ?? r.patient_number ?? "",
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

  const aiDeadline = Date.now() + aiBudgetMs;

  const matchPeople = async (toMatch: ToMatch[], errors: string[]) => {
    const counts = { autoMatched: 0, suggested: 0, unmatched: 0, aiCalls: 0 };
    if (toMatch.length === 0) return counts;
    const idx = await loadIndex();
    const aiQueue: (ToMatch & { candidates: PatientRef[] })[] = [];
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
    return counts;
  };

  /** Names never seen on the House Sheet (a past tab, or another sheet) join house_sheet_people
   * marked off-sheet -- so they never count as in the house today -- and are matched. */
  const addUnseen = async (
    names: { nameKey: string; patientName: string; carerName: string | null; date: string; extra?: Record<string, unknown> }[],
    errors: string[]
  ) => {
    const uniq = [...new Map(names.map((n) => [n.nameKey, n])).values()];
    if (uniq.length === 0) return { inserted: 0, autoMatched: 0, suggested: 0, unmatched: 0, aiCalls: 0 };
    const { data: known, error: knownError } = await admin.schema("ops").from("house_sheet_people").select("name_key").in("name_key", uniq.map((n) => n.nameKey));
    if (knownError) throw new Error(knownError.message);
    const knownKeys = new Set((known ?? []).map((k) => k.name_key as string));
    const fresh = uniq
      .filter((n) => !knownKeys.has(n.nameKey))
      .map((n) => ({
        name_key: n.nameKey,
        patient_name: n.patientName,
        carer_name: n.carerName,
        first_seen_on: n.date,
        run_started_on: n.date,
        last_seen_on: n.date,
        days_seen: 1,
        off_sheet_at: new Date().toISOString(),
        ...n.extra,
      }));
    let inserted: ToMatch[] = [];
    if (fresh.length > 0) {
      const { data, error } = await admin.schema("ops").from("house_sheet_people").insert(fresh).select("id, patient_name, carer_name, relationship");
      if (error) errors.push(`insert ${fresh.length} row(s): ${error.message}`);
      inserted = ((data ?? []) as { id: string; patient_name: string; carer_name: string | null; relationship: string | null }[]).map((r) => ({
        id: r.id,
        patientName: r.patient_name,
        carerName: r.carer_name,
        relationship: r.relationship,
      }));
    }
    return { inserted: inserted.length, ...(await matchPeople(inserted, errors)) };
  };

  return { matchPeople, addUnseen };
}
