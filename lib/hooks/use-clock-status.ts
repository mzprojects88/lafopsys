"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";
import { useStaffRoster, type StaffRosterEntry } from "@/lib/hooks/use-staff-roster";
import { useTimeEntriesData, type MutationResult } from "@/lib/hooks/use-time-entries-collection";
import { todayIso } from "@/lib/utils/date";
import type { PunchLocationStatus } from "@/lib/types/staff";

/** How long to wait for a GPS fix before punching without one. A staff member
 * standing in a concrete stairwell should not be left holding a spinner. */
const GEO_TIMEOUT_MS = 8000;

interface CapturedLocation {
  latitude?: number;
  longitude?: number;
  accuracyMeters?: number;
  locationStatus: PunchLocationStatus;
}

/**
 * Asks the browser for a position, resolving either way -- never rejects.
 * A refused or failed location must not block a punch: the clock-in gate locks
 * staff out of every screen until they clock in, so a location failure that
 * blocked clocking in would lock them out of their job.
 */
function captureLocation(): Promise<CapturedLocation> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve({ locationStatus: "unavailable" });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: position.coords.accuracy,
          locationStatus: "captured",
        }),
      (error) =>
        resolve({
          locationStatus: error.code === error.PERMISSION_DENIED ? "permission_denied" : "unavailable",
        }),
      { enableHighAccuracy: true, timeout: GEO_TIMEOUT_MS, maximumAge: 0 }
    );
  });
}

/**
 * Single source of truth for "is the current logged-in staff member clocked
 * in today" — drives the /staff clock widget, the clock-in-required dialog,
 * the topbar status badge, and the app-wide navigation gate. `me` is matched
 * against the real Supabase Auth session id, not a name string.
 *
 * Punching goes through `app/api/dtr/punch/route.ts` rather than writing
 * `ops.time_entries` directly, so every punch also lands in the DTR with its
 * location, device and IP. Both `clockIn` and `clockOut` keep their original
 * no-argument signature, so the widget and the required-dialog pick up location
 * capture without changing.
 */
export function useClockStatus() {
  const { staff, loading: staffLoading } = useStaffRoster();
  const { entries, loading: entriesLoading, refetch } = useTimeEntriesData();
  const [authId, setAuthId] = React.useState<string | undefined>(undefined);

  React.useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setAuthId(data.user?.id);
    });
  }, []);

  const loading = staffLoading || entriesLoading || authId === undefined;
  const me: StaffRosterEntry | undefined = authId ? staff.find((s) => s.id === authId) : undefined;
  const today = todayIso();
  const todayEntry = me ? entries.find((t) => t.staffId === me.id && t.date === today) : undefined;
  const clockedIn = !!todayEntry?.clockIn && !todayEntry?.clockOut;
  const hasClockedInToday = !!todayEntry?.clockIn;

  async function punch(punchType: "clock_in" | "clock_out"): Promise<MutationResult | undefined> {
    if (!me) return undefined;
    const location = await captureLocation();

    let response: Response;
    try {
      response = await fetch("/api/dtr/punch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ punchType, ...location }),
      });
    } catch {
      return { ok: false, error: "Couldn't reach the server. Check your connection and try again." };
    }

    const result = (await response.json().catch(() => null)) as
      | { ok: true; locationStatus: PunchLocationStatus; addressLabel: string | null }
      | { ok: false; error: string }
      | null;

    if (!response.ok || !result || result.ok === false) {
      return { ok: false, error: result && "error" in result ? result.error : "Couldn't record the punch." };
    }

    await refetch();
    return { ok: true, id: punchType };
  }

  async function clockIn(): Promise<MutationResult | undefined> {
    return punch("clock_in");
  }

  async function clockOut(): Promise<MutationResult | undefined> {
    if (!todayEntry) return undefined;
    return punch("clock_out");
  }

  return { me, todayEntry, clockedIn, hasClockedInToday, loading, clockIn, clockOut };
}
