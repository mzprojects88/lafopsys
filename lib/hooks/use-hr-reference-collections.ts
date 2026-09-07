"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";
import type { Holiday, HolidayKind, LeaveEligibility, LeaveEntitlementSource, LeaveType, RateTable, RateTableKind, RateTableStatus } from "@/lib/types/hr";

/**
 * The reference tables of 0037: holidays, government rate tables and leave
 * types. Small, readable by every role, edited by HR from /hr/settings
 * through server actions.
 */

// --- Holidays ----------------------------------------------------------------

interface HolidayRow {
  id: string;
  date: string;
  name: string;
  kind: HolidayKind;
  scope_city: string | null;
  source: string | null;
}

export const holidaysStore = createCollection<Holiday[]>({
  key: "hr.holidays",
  empty: [],
  tables: [{ schema: "hr", table: "holidays" }],
  fetch: async () => {
    const { data, error } = await createClient().schema("hr").from("holidays").select("*").order("date");
    if (error) throw new Error(error.message);
    return ((data ?? []) as HolidayRow[]).map((row) => ({
      id: row.id,
      date: row.date,
      name: row.name,
      kind: row.kind,
      scopeCity: row.scope_city,
      source: row.source,
    }));
  },
});

export function useHolidays() {
  const { data: holidays, loading, error } = useCollection(holidaysStore);
  return { holidays, loading, error };
}

// --- Rate tables -------------------------------------------------------------

interface RateTableRow {
  id: string;
  kind: RateTableKind;
  effective_from: string;
  effective_to: string | null;
  status: RateTableStatus;
  source: string;
  params: Record<string, unknown> | null;
  rows: unknown[] | null;
  notes: string | null;
  updated_at: string;
}

export function toRateTable(row: RateTableRow): RateTable {
  return {
    id: row.id,
    kind: row.kind,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    status: row.status,
    source: row.source,
    params: row.params ?? {},
    rows: row.rows ?? [],
    notes: row.notes,
    updatedAt: row.updated_at,
  };
}

export const rateTablesStore = createCollection<RateTable[]>({
  key: "hr.rate_tables",
  empty: [],
  tables: [{ schema: "hr", table: "rate_tables" }],
  fetch: async () => {
    const { data, error } = await createClient().schema("hr").from("rate_tables").select("*").order("kind").order("effective_from", { ascending: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as RateTableRow[]).map(toRateTable);
  },
});

export function useRateTables() {
  const { data: rateTables, loading, error } = useCollection(rateTablesStore);
  return { rateTables, loading, error };
}

// --- Leave types -------------------------------------------------------------

interface LeaveTypeRow {
  id: string;
  name: string;
  statutory: boolean;
  paid: boolean;
  entitlement_source: LeaveEntitlementSource;
  days_default: number | string | null;
  eligibility: LeaveEligibility | null;
  requires_document: boolean;
  law_ref: string | null;
  active: boolean;
  sort: number;
}

export const leaveTypesStore = createCollection<LeaveType[]>({
  key: "hr.leave_types",
  empty: [],
  tables: [{ schema: "hr", table: "leave_types" }],
  fetch: async () => {
    const { data, error } = await createClient().schema("hr").from("leave_types").select("*").order("sort");
    if (error) throw new Error(error.message);
    return ((data ?? []) as LeaveTypeRow[]).map((row) => ({
      id: row.id,
      name: row.name,
      statutory: row.statutory,
      paid: row.paid,
      entitlementSource: row.entitlement_source,
      daysDefault: row.days_default === null ? null : Number(row.days_default),
      eligibility: row.eligibility ?? {},
      requiresDocument: row.requires_document,
      lawRef: row.law_ref,
      active: row.active,
      sort: row.sort,
    }));
  },
});

export function useLeaveTypes() {
  const { data: leaveTypes, loading, error } = useCollection(leaveTypesStore);
  return { leaveTypes, loading, error };
}
