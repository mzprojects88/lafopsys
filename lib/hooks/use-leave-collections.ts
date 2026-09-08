"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";
import type { LeaveAdjustment, LeaveAdjustmentKind, LeaveRequest, LeaveRequestStatus } from "@/lib/types/hr";

interface LeaveRequestRow {
  id: string;
  employee_id: string;
  leave_type_id: string;
  starts_on: string;
  ends_on: string;
  start_half: boolean;
  end_half: boolean;
  days: number | string;
  reason: string | null;
  document_url: string | null;
  status: LeaveRequestStatus;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
}

export function toLeaveRequest(row: LeaveRequestRow): LeaveRequest {
  return {
    id: row.id,
    employeeId: row.employee_id,
    leaveTypeId: row.leave_type_id,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    startHalf: row.start_half,
    endHalf: row.end_half,
    days: Number(row.days),
    reason: row.reason,
    documentUrl: row.document_url,
    status: row.status,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    decisionNote: row.decision_note,
    createdAt: row.created_at,
  };
}

/**
 * Leave requests (hr.leave_requests, 0040): RLS gives HR every row and an
 * employee their own, so the same store serves the approvals queue and
 * "my leave". Small enough to hold whole -- a few dozen rows a year.
 */
export const leaveRequestsStore = createCollection<LeaveRequest[]>({
  key: "hr.leave_requests",
  empty: [],
  tables: [{ schema: "hr", table: "leave_requests" }],
  fetch: async () => {
    const { data, error } = await createClient().schema("hr").from("leave_requests").select("*").order("starts_on", { ascending: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as LeaveRequestRow[]).map(toLeaveRequest);
  },
});

export function useLeaveRequests() {
  const { data: requests, loading, error } = useCollection(leaveRequestsStore);
  return { requests, loading, error };
}

interface LeaveAdjustmentRow {
  id: string;
  employee_id: string;
  leave_type_id: string;
  year: number;
  kind: LeaveAdjustmentKind;
  days: number | string;
  note: string | null;
  created_at: string;
}

export const leaveAdjustmentsStore = createCollection<LeaveAdjustment[]>({
  key: "hr.leave_adjustments",
  empty: [],
  tables: [{ schema: "hr", table: "leave_adjustments" }],
  fetch: async () => {
    const { data, error } = await createClient().schema("hr").from("leave_adjustments").select("*").order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as LeaveAdjustmentRow[]).map((row) => ({
      id: row.id,
      employeeId: row.employee_id,
      leaveTypeId: row.leave_type_id,
      year: row.year,
      kind: row.kind,
      days: Number(row.days),
      note: row.note,
      createdAt: row.created_at,
    }));
  },
});

export function useLeaveAdjustments() {
  const { data: adjustments, loading, error } = useCollection(leaveAdjustmentsStore);
  return { adjustments, loading, error };
}
