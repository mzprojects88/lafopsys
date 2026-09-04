"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";
import type { TimesheetApproval, TimesheetStatus } from "@/lib/types/staff";

export type MutationResult = { ok: true } | { ok: false; error: string };

interface TimesheetApprovalRow {
  id: string;
  time_entry_id: string;
  staff_id: string;
  status: TimesheetStatus;
  adjustment_reason: string | null;
  reviewed_by: string | null;
}

function toTimesheetApproval(row: TimesheetApprovalRow): TimesheetApproval {
  return {
    id: row.id,
    timeEntryId: row.time_entry_id,
    staffId: row.staff_id,
    status: row.status,
    adjustmentReason: row.adjustment_reason ?? undefined,
    reviewedBy: row.reviewed_by ?? undefined,
  };
}

/** Real ops.timesheet_approvals -- starts empty, no real historical approval
 * data exists (generated with `rng` in lib/mock-data/staff.ts). */
export const timesheetApprovalsStore = createCollection<TimesheetApproval[]>({
  key: "ops.timesheet_approvals",
  empty: [],
  tables: [{ schema: "ops", table: "timesheet_approvals" }],
  fetch: async () => {
    const supabase = createClient();
    const { data, error } = await supabase.schema("ops").from("timesheet_approvals").select("*");
    if (error) throw new Error(error.message);
    return (data ?? []).map(toTimesheetApproval);
  },
});

export function useTimesheetApprovalsData() {
  const { data: approvals, loading } = useCollection(timesheetApprovalsStore);

  async function updateStatus(id: string, status: TimesheetStatus, adjustmentReason?: string): Promise<MutationResult> {
    const supabase = createClient();
    const { error } = await supabase
      .schema("ops")
      .from("timesheet_approvals")
      .update({ status, adjustment_reason: adjustmentReason ?? null })
      .eq("id", id);
    if (error) return { ok: false, error: error.message };
    await timesheetApprovalsStore.refetch();
    return { ok: true };
  }

  return { approvals, loading, updateStatus, refetch: timesheetApprovalsStore.refetch };
}
