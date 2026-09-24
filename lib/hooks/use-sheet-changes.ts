"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";

export interface SheetChange {
  id: string;
  sheetCn: string;
  patientId: string | null;
  kind: "field" | "new_child";
  field: string | null;
  label: string;
  sheetBefore: string | null;
  sheetAfter: string;
  appNow: string | null;
  status: "pending" | "applied" | "dismissed";
  aiSummary: string | null;
  aiFlag: "typo" | "format" | "real" | "serious" | "duplicate" | "new" | null;
  aiCandidatePatientId: string | null;
  aiConfidence: number | null;
  aiError: string | null;
  detectedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
}

interface Row {
  id: string;
  sheet_cn: string;
  patient_id: string | null;
  kind: SheetChange["kind"];
  field: string | null;
  label: string;
  sheet_before: string | null;
  sheet_after: string;
  app_now: string | null;
  status: SheetChange["status"];
  ai_summary: string | null;
  ai_flag: SheetChange["aiFlag"];
  ai_candidate_patient_id: string | null;
  ai_confidence: number | string | null;
  ai_error: string | null;
  detected_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
}

/** Changes found on the original sheet (0064): everything waiting, and the latest decided. */
export const sheetChangesStore = createCollection<SheetChange[]>({
  key: "ops.sheet_changes",
  empty: [],
  tables: [{ schema: "ops", table: "sheet_changes" }],
  fetch: async () => {
    const cols = "id, sheet_cn, patient_id, kind, field, label, sheet_before, sheet_after, app_now, status, ai_summary, ai_flag, ai_candidate_patient_id, ai_confidence, ai_error, detected_at, decided_by, decided_at, decision_note";
    const supabase = createClient().schema("ops");
    const [pending, decided] = await Promise.all([
      supabase.from("sheet_changes").select(cols).eq("status", "pending").order("detected_at"),
      supabase.from("sheet_changes").select(cols).neq("status", "pending").order("decided_at", { ascending: false }).limit(40),
    ]);
    if (pending.error) throw new Error(pending.error.message);
    if (decided.error) throw new Error(decided.error.message);
    return [...((pending.data ?? []) as Row[]), ...((decided.data ?? []) as Row[])].map((r) => ({
      id: r.id,
      sheetCn: r.sheet_cn,
      patientId: r.patient_id,
      kind: r.kind,
      field: r.field,
      label: r.label,
      sheetBefore: r.sheet_before,
      sheetAfter: r.sheet_after,
      appNow: r.app_now,
      status: r.status,
      aiSummary: r.ai_summary,
      aiFlag: r.ai_flag,
      aiCandidatePatientId: r.ai_candidate_patient_id,
      aiConfidence: r.ai_confidence == null ? null : Number(r.ai_confidence),
      aiError: r.ai_error,
      detectedAt: r.detected_at,
      decidedBy: r.decided_by,
      decidedAt: r.decided_at,
      decisionNote: r.decision_note,
    }));
  },
});

export function useSheetChanges() {
  const { data: changes, loading } = useCollection(sheetChangesStore);
  const pending = changes.filter((c) => c.status === "pending");

  async function decide(id: string, action: "apply" | "dismiss" | "link", extra: { patientId?: string; note?: string } = {}): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      const r = (await (
        await fetch("/api/patients/sheet-changes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action, ...extra }) })
      ).json()) as { ok: boolean; error?: string };
      await sheetChangesStore.refetch();
      return r.ok ? { ok: true } : { ok: false, error: r.error ?? "The change could not be saved." };
    } catch {
      return { ok: false, error: "Couldn't reach the server." };
    }
  }

  return { changes, pending, loading, decide };
}
