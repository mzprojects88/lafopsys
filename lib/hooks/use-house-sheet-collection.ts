"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";
import type { HouseSheetCandidate, HouseSheetPerson, HouseSheetSyncRun } from "@/lib/types/house-sheet";

interface PersonRow {
  id: string;
  name_key: string;
  row_no: number | null;
  patient_name: string;
  carer_name: string | null;
  relationship: string | null;
  next_appointment_raw: string | null;
  next_appointment_on: string | null;
  treatment: string | null;
  address: string | null;
  laf_flag: boolean;
  phone: string | null;
  first_seen_on: string;
  last_seen_on: string;
  days_seen: number;
  off_sheet_at: string | null;
  match_status: HouseSheetPerson["matchStatus"];
  matched_patient_id: string | null;
  match_method: HouseSheetPerson["matchMethod"];
  match_confidence: number | string | null;
  ai_candidates: HouseSheetCandidate[] | null;
  ai_reason: string | null;
  ai_error: string | null;
  ai_attempts: number;
  referral_id: string | null;
  referral: { admitted_patient_id: string | null } | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  updated_at: string;
}

function toPerson(r: PersonRow): HouseSheetPerson {
  return {
    id: r.id,
    nameKey: r.name_key,
    rowNo: r.row_no,
    patientName: r.patient_name,
    carerName: r.carer_name,
    relationship: r.relationship,
    nextAppointmentRaw: r.next_appointment_raw,
    nextAppointmentOn: r.next_appointment_on,
    treatment: r.treatment,
    address: r.address,
    lafFlag: r.laf_flag,
    phone: r.phone,
    firstSeenOn: r.first_seen_on,
    lastSeenOn: r.last_seen_on,
    daysSeen: r.days_seen,
    offSheetAt: r.off_sheet_at,
    matchStatus: r.match_status,
    matchedPatientId: r.matched_patient_id,
    matchMethod: r.match_method,
    matchConfidence: r.match_confidence === null ? null : Number(r.match_confidence),
    aiCandidates: r.ai_candidates ?? [],
    aiReason: r.ai_reason,
    aiError: r.ai_error,
    aiAttempts: r.ai_attempts,
    referralId: r.referral_id,
    referralPatientId: r.referral?.admitted_patient_id ?? null,
    reviewedBy: r.reviewed_by,
    reviewedAt: r.reviewed_at,
    updatedAt: r.updated_at,
  };
}

/** Everyone the Occupancy Tracker has listed, on-sheet first, newest day first. */
export const houseSheetPeopleStore = createCollection<HouseSheetPerson[]>({
  key: "ops.house_sheet_people",
  empty: [],
  tables: [
    { schema: "ops", table: "house_sheet_people" },
    { schema: "ops", table: "referrals" },
  ],
  fetch: async () => {
    const { data, error } = await createClient()
      .schema("ops")
      .from("house_sheet_people")
      .select("*, referral:referrals(admitted_patient_id)")
      .order("last_seen_on", { ascending: false })
      .order("row_no", { ascending: true, nullsFirst: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as PersonRow[]).map(toPerson);
  },
});

export function useHouseSheetPeople() {
  const { data: people, loading, error } = useCollection(houseSheetPeopleStore);
  return { people, loading, error, refetch: houseSheetPeopleStore.refetch };
}

interface RunRow {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: HouseSheetSyncRun["status"];
  trigger: HouseSheetSyncRun["trigger"];
  triggered_by: string | null;
  tab_date: string | null;
  rows_seen: number;
  inserted: number;
  updated: number;
  off_sheet: number;
  returned: number;
  auto_matched: number;
  suggested: number;
  unmatched: number;
  ai_calls: number;
  error: string | null;
}

function toRun(r: RunRow): HouseSheetSyncRun {
  return {
    id: r.id,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    status: r.status,
    trigger: r.trigger,
    triggeredBy: r.triggered_by,
    tabDate: r.tab_date,
    rowsSeen: r.rows_seen,
    inserted: r.inserted,
    updated: r.updated,
    offSheet: r.off_sheet,
    returned: r.returned,
    autoMatched: r.auto_matched,
    suggested: r.suggested,
    unmatched: r.unmatched,
    aiCalls: r.ai_calls,
    error: r.error,
  };
}

/** The last fifty checks of the tracker, newest first. */
export const houseSheetRunsStore = createCollection<HouseSheetSyncRun[]>({
  key: "ops.house_sheet_sync_runs",
  empty: [],
  tables: [{ schema: "ops", table: "house_sheet_sync_runs" }],
  fetch: async () => {
    const { data, error } = await createClient().schema("ops").from("house_sheet_sync_runs").select("*").order("started_at", { ascending: false }).limit(50);
    if (error) throw new Error(error.message);
    return ((data ?? []) as RunRow[]).map(toRun);
  },
});

export function useHouseSheetRuns() {
  const { data: runs, loading, error } = useCollection(houseSheetRunsStore);
  return { runs, loading, error, refetch: houseSheetRunsStore.refetch };
}

export function houseSheetRunChangedSomething(run: HouseSheetSyncRun): boolean {
  return run.status === "success" && run.inserted + run.updated + run.offSheet + run.returned > 0;
}
