"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";
import { useStaffRoster, type StaffRosterEntry } from "@/lib/hooks/use-staff-roster";
import { useTimeEntriesData, type MutationResult } from "@/lib/hooks/use-time-entries-collection";
import { TODAY_ISO } from "@/lib/utils/seeded-random";

function nowLabel() {
  return new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Single source of truth for "is the current logged-in staff member clocked
 * in today" — drives the /staff clock widget, the clock-in-required dialog,
 * the topbar status badge, and the app-wide navigation gate. `me` is matched
 * against the real Supabase Auth session id, not a name string.
 */
export function useClockStatus() {
  const { staff, loading: staffLoading } = useStaffRoster();
  const { entries, loading: entriesLoading, clockIn: clockInEntry, clockOut: clockOutEntry } = useTimeEntriesData();
  const [authId, setAuthId] = React.useState<string | undefined>(undefined);

  React.useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setAuthId(data.user?.id);
    });
  }, []);

  const loading = staffLoading || entriesLoading || authId === undefined;
  const me: StaffRosterEntry | undefined = authId ? staff.find((s) => s.id === authId) : undefined;
  const todayEntry = me ? entries.find((t) => t.staffId === me.id && t.date === TODAY_ISO) : undefined;
  const clockedIn = !!todayEntry?.clockIn && !todayEntry?.clockOut;
  const hasClockedInToday = !!todayEntry?.clockIn;

  async function clockIn(): Promise<MutationResult | undefined> {
    if (!me) return undefined;
    return clockInEntry(me.id, TODAY_ISO, nowLabel());
  }

  async function clockOut(): Promise<MutationResult | undefined> {
    if (!todayEntry) return undefined;
    return clockOutEntry(todayEntry.id, nowLabel());
  }

  return { me, todayEntry, clockedIn, hasClockedInToday, loading, clockIn, clockOut };
}
