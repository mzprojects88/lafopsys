"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";
import type { CashEntry, ApprovalStatus } from "@/lib/types/finance";

export type MutationResult = { ok: true } | { ok: false; error: string };

interface CashEntryRow {
  id: string;
  date: string | null;
  direction: CashEntry["direction"];
  source: CashEntry["source"];
  entity: CashEntry["entity"];
  currency: CashEntry["currency"];
  amount: number;
  program_id: string | null;
  description: string;
  approval_status: ApprovalStatus;
  donor_name: string | null;
  source_sheet: string | null;
  needs_review: boolean;
  review_reason: string | null;
  duplicate_of_id: string | null;
}

function toCashEntry(row: CashEntryRow): CashEntry {
  return {
    id: row.id,
    date: row.date ?? "",
    direction: row.direction,
    source: row.source,
    entity: row.entity,
    currency: row.currency,
    amount: row.amount,
    programId: row.program_id ?? undefined,
    description: row.description,
    approvalStatus: row.approval_status,
    donorName: row.donor_name ?? undefined,
    sourceSheet: row.source_sheet ?? undefined,
    needsReview: row.needs_review,
    reviewReason: row.review_reason ?? undefined,
    duplicateOfId: row.duplicate_of_id ?? undefined,
  };
}

export function useCashEntriesData() {
  const [entries, setEntries] = React.useState<CashEntry[]>([]);
  const [loading, setLoading] = React.useState(true);

  const refetch = React.useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.schema("ops").from("cash_entries").select("*").order("date", { ascending: false, nullsFirst: false });
    setEntries((data ?? []).map(toCashEntry));
    setLoading(false);
  }, []);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from Supabase, an external system
    refetch();
  }, [refetch]);

  async function addEntry(entry: Omit<CashEntry, "id">): Promise<MutationResult> {
    const supabase = createClient();
    const { error } = await supabase.schema("ops").from("cash_entries").insert({
      id: crypto.randomUUID(),
      date: entry.date || null,
      direction: entry.direction,
      source: entry.source,
      entity: entry.entity,
      currency: entry.currency,
      amount: entry.amount,
      program_id: entry.programId ?? null,
      description: entry.description,
      approval_status: entry.approvalStatus,
      needs_review: false,
    });
    if (error) return { ok: false, error: error.message };
    await refetch();
    return { ok: true };
  }

  async function setApprovalStatus(id: string, status: ApprovalStatus): Promise<MutationResult> {
    const supabase = createClient();
    const { error } = await supabase.schema("ops").from("cash_entries").update({ approval_status: status }).eq("id", id);
    if (error) return { ok: false, error: error.message };
    await refetch();
    return { ok: true };
  }

  return { entries, loading, addEntry, setApprovalStatus, refetch };
}
