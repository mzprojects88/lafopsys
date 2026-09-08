"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";
import { useScheduleOverrides } from "@/lib/hooks/use-pay-periods-collection";
import { scheduledShift, type ShiftTimes } from "@/lib/utils/attendance";
import type { EmploymentStatus, SchedulePattern } from "@/lib/types/hr";

export interface RosterPerson {
  employeeId: string;
  staffId: string | null;
  firstName: string;
  lastName: string;
  position: string;
  status: EmploymentStatus;
}

interface RosterRow {
  employee_id: string;
  staff_id: string | null;
  first_name: string;
  last_name: string;
  position: string;
  status: EmploymentStatus;
}

/** Every working employee, readable by all staff (hr.v_roster, 0041). */
export const rosterStore = createCollection<RosterPerson[]>({
  key: "hr.v_roster",
  empty: [],
  tables: [{ schema: "hr", table: "employees" }],
  fetch: async () => {
    const { data, error } = await createClient().schema("hr").from("v_roster").select("*").order("last_name");
    if (error) throw new Error(error.message);
    return ((data ?? []) as RosterRow[]).map((r) => ({
      employeeId: r.employee_id,
      staffId: r.staff_id,
      firstName: r.first_name,
      lastName: r.last_name,
      position: r.position,
      status: r.status,
    }));
  },
});

interface ScheduleRow {
  employee_id: string;
  effective_from: string;
  effective_to: string | null;
  pattern: SchedulePattern;
  break_minutes: number;
  hours_per_day: number | string;
}

export interface RosterSchedule {
  employeeId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  pattern: SchedulePattern;
  breakMinutes: number;
  hoursPerDay: number;
}

/** Every schedule row of everyone (staff-readable per 0036). A handful of rows. */
export const allSchedulesStore = createCollection<RosterSchedule[]>({
  key: "hr.work_schedules:all",
  empty: [],
  tables: [{ schema: "hr", table: "work_schedules" }],
  fetch: async () => {
    const { data, error } = await createClient().schema("hr").from("work_schedules").select("employee_id, effective_from, effective_to, pattern, break_minutes, hours_per_day");
    if (error) throw new Error(error.message);
    return ((data ?? []) as ScheduleRow[]).map((r) => ({
      employeeId: r.employee_id,
      effectiveFrom: r.effective_from,
      effectiveTo: r.effective_to,
      pattern: r.pattern,
      breakMinutes: r.break_minutes,
      hoursPerDay: Number(r.hours_per_day),
    }));
  },
});

export interface RosterEntry {
  person: RosterPerson;
  day: string;
  shift: ShiftTimes | null;
  /** true when the day is a rest day by pattern or override. */
  restDay: boolean;
  /** true when an override set this day. */
  overridden: boolean;
  hasSchedule: boolean;
}

/**
 * The roster: who is scheduled when, from the weekly patterns and the
 * per-day overrides. `shiftFor(person, day)` answers for one person and
 * `onDay(day)` lists everyone scheduled that day, in start-time order.
 */
export function useRoster() {
  const { data: people, loading: peopleLoading } = useCollection(rosterStore);
  const { data: schedules, loading: schedulesLoading } = useCollection(allSchedulesStore);
  const { overrides, loading: overridesLoading } = useScheduleOverrides();

  const entryFor = React.useCallback(
    (person: RosterPerson, day: string): RosterEntry => {
      const schedule = schedules
        .filter((s) => s.employeeId === person.employeeId && s.effectiveFrom <= day && (s.effectiveTo === null || s.effectiveTo > day))
        .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))[0];
      const own = overrides.filter((o) => o.employeeId === person.employeeId);
      const override = own.find((o) => o.date === day);
      const shift = scheduledShift(day, schedule ? { pattern: schedule.pattern, breakMinutes: schedule.breakMinutes, hoursPerDay: schedule.hoursPerDay } : null, own);
      const hasSchedule = Boolean(schedule) || Boolean(override);
      return { person, day, shift, restDay: hasSchedule && shift === null, overridden: Boolean(override), hasSchedule };
    },
    [schedules, overrides]
  );

  const onDay = React.useCallback(
    (day: string) =>
      people
        .map((p) => entryFor(p, day))
        .filter((e) => e.shift !== null)
        .sort((a, b) => (a.shift!.start < b.shift!.start ? -1 : a.shift!.start > b.shift!.start ? 1 : 0)),
    [people, entryFor]
  );

  return { people, entryFor, onDay, overrides, loading: peopleLoading || schedulesLoading || overridesLoading };
}
