"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";
import type { Direction, HistoryDayData, HistoryMonthDay, Meal } from "@/lib/utils/history";

/** The calendar's days (ops.history_month, 0167). */
export function useHistoryMonth(from: string, to: string) {
  const [days, setDays] = React.useState<HistoryMonthDay[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    let live = true;
    void createClient()
      .schema("ops")
      .rpc("history_month", { p_from: from, p_to: to })
      .then(({ data, error: e }) => {
        if (!live) return;
        setError(e?.message ?? null);
        setDays((data as HistoryMonthDay[] | null) ?? []);
      });
    return () => {
      live = false;
    };
  }, [from, to, tick]);
  return { days, error, refetch: () => setTick((t) => t + 1) };
}

/** One day's children (ops.history_day, 0167); null while none is open. */
export function useHistoryDay(day: string | null) {
  const [data, setData] = React.useState<HistoryDayData | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    if (!day) return;
    let live = true;
    void createClient()
      .schema("ops")
      .rpc("history_day", { p_day: day })
      .then(({ data: d, error: e }) => {
        if (!live) return;
        setError(e?.message ?? null);
        setData((d as HistoryDayData | null) ?? null);
      });
    return () => {
      live = false;
    };
  }, [day, tick]);
  return { data: day && data?.day === day ? data : null, error, refetch: () => setTick((t) => t + 1) };
}

export type HistoryResult = { ok: true; data: unknown } | { ok: false; error: string; hint?: string };

async function call(fn: string, args: Record<string, unknown>): Promise<HistoryResult> {
  const { data, error } = await createClient().schema("ops").rpc(fn, args);
  return error ? { ok: false, error: error.message, hint: error.hint ?? undefined } : { ok: true, data };
}

/** The History writes; each checks access, the back-limit and the note in the database (0167). */
export const history = {
  readDay: (day: string) => call("history_day", { p_day: day }),
  saveNight: (day: string, patientId: string, unitId: string, opts: { carerId?: string | null; people?: number | null; note?: string }) =>
    call("history_save_night", { p_day: day, p_patient_id: patientId, p_unit_id: unitId, p_carer_id: opts.carerId ?? null, p_people: opts.people ?? null, p_note: opts.note || null }),
  removeNights: (day: string, patientIds: string[], note?: string) => call("history_remove_nights", { p_day: day, p_patient_ids: patientIds, p_note: note || null }),
  setMeals: (day: string, patientIds: string[], meals: Meal[], on: boolean, note?: string) =>
    call("history_set_meals", { p_day: day, p_patient_ids: patientIds, p_meals: meals, p_on: on, p_note: note || null }),
  setRides: (day: string, patientIds: string[], direction: Direction, on: boolean, opts: { people?: number; note?: string }) =>
    call("history_set_rides", { p_day: day, p_patient_ids: patientIds, p_direction: direction, p_on: on, p_people: opts.people ?? 2, p_trip_id: null, p_note: opts.note || null }),
  completeDay: (day: string, complete: boolean, opts: { note?: string; fewerOk?: boolean }) =>
    call("history_complete_day", { p_day: day, p_complete: complete, p_note: opts.note || null, p_fewer_ok: opts.fewerOk ?? false }),
};
