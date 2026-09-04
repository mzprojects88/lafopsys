"use client";

import { useRole } from "@/context/role-provider";
import { invalidateTables, useCollection } from "@/lib/data/collection-store";
import { staffRosterStore, type StaffRosterEntry } from "@/lib/hooks/use-staff-roster";
import { timeEntriesStore, type MutationResult } from "@/lib/hooks/use-time-entries-collection";
import { appSettingsStore } from "@/lib/hooks/use-app-settings";
import { INVENTORY_ROLES } from "@/lib/rbac/roles";
import { todayIso } from "@/lib/utils/date";
import { addDays } from "@/lib/utils/dtr";
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
 * "Is the current logged-in staff member clocked in today" -- drives the
 * /staff clock widget, the clock-in-required dialog, the topbar status badge,
 * and the app-wide navigation gate.
 *
 * A pure derivation over the shared staff / time_entries / app_settings
 * stores plus the auth id from RoleProvider: every component that calls this
 * reads the same data, so one punch flips all of them in the same render.
 * (Previously each caller held its own fetched copy, and the gate in the app
 * shell never learned about a punch made by the dialog until a page reload.)
 *
 * "Clocked in" means an *open* daily entry (clock_in set, clock_out null)
 * dated today or yesterday -- a Night/24hr shift crosses midnight and must
 * still read as clocked in, and be closable, after it. Same rule as the
 * punch route. Sessions and hours come from the punches (use-dtr-sessions.ts);
 * this hook deliberately doesn't read that table because it is mounted in the
 * app shell on every page.
 *
 * Punching goes through `app/api/dtr/punch/route.ts` rather than writing
 * `ops.time_entries` directly, so every punch also lands in the DTR with its
 * location, device and IP.
 */
export function useClockStatus() {
  const { staffId } = useRole();
  const { data: staff, loading: staffLoading } = useCollection(staffRosterStore);
  const { data: entries, loading: entriesLoading } = useCollection(timeEntriesStore);
  const { data: settings, loading: settingsLoading } = useCollection(appSettingsStore);

  const loading = staffLoading || entriesLoading || settingsLoading || staffId === undefined;
  const me: StaffRosterEntry | undefined = staffId ? staff.find((s) => s.id === staffId) : undefined;
  const today = todayIso();
  const yesterday = addDays(today, -1);
  const todayEntry = me ? entries.find((t) => t.staffId === me.id && t.date === today) : undefined;
  const openEntry = me
    ? entries.find((t) => t.staffId === me.id && (t.date === today || t.date === yesterday) && !!t.clockIn && !t.clockOut)
    : undefined;
  const clockedIn = !!openEntry;
  const hasClockedInToday = !!todayEntry?.clockIn || clockedIn;
  // Non-inventory roles must always clock in, as before. Inventory roles are
  // exempt until an admin turns on the "require clock-in" setting (see
  // components/modules/settings/clock-in-requirement-toggle.tsx).
  const clockInRequired = !me ? false : !INVENTORY_ROLES.includes(me.role) || settings.requireClockInForInventoryRoles;

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

    // The shared store update is what closes the dialog, flips the badge and
    // releases the gate everywhere at once. The DTR page reads time_punches.
    await timeEntriesStore.refetch();
    void invalidateTables([{ schema: "ops", table: "time_punches" }]);
    return { ok: true, id: punchType };
  }

  async function clockIn(): Promise<MutationResult | undefined> {
    return punch("clock_in");
  }

  async function clockOut(): Promise<MutationResult | undefined> {
    if (!openEntry) return undefined;
    return punch("clock_out");
  }

  return {
    me,
    todayEntry,
    openEntry,
    clockedIn,
    hasClockedInToday,
    clockInRequired,
    loading,
    clockIn,
    clockOut,
    refetch: timeEntriesStore.refetch,
  };
}
