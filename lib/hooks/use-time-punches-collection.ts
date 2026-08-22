"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";
import type { PunchDeviceType, PunchLocationStatus, TimePunch } from "@/lib/types/staff";

interface TimePunchRow {
  id: string;
  time_entry_id: string | null;
  staff_id: string;
  punch_type: "clock_in" | "clock_out";
  punched_at: string;
  latitude: number | null;
  longitude: number | null;
  accuracy_meters: number | null;
  address_label: string | null;
  location_status: PunchLocationStatus;
  ip_address: string | null;
  user_agent: string | null;
  device_label: string | null;
  device_type: PunchDeviceType;
}

function toTimePunch(row: TimePunchRow): TimePunch {
  return {
    id: row.id,
    timeEntryId: row.time_entry_id ?? undefined,
    staffId: row.staff_id,
    punchType: row.punch_type,
    punchedAt: row.punched_at,
    latitude: row.latitude ?? undefined,
    longitude: row.longitude ?? undefined,
    accuracyMeters: row.accuracy_meters ?? undefined,
    addressLabel: row.address_label ?? undefined,
    locationStatus: row.location_status,
    ipAddress: row.ip_address ?? undefined,
    userAgent: row.user_agent ?? undefined,
    deviceLabel: row.device_label ?? undefined,
    deviceType: row.device_type,
  };
}

/**
 * DTR punch history from `ops.time_punches`, newest first.
 *
 * `address_json` is deliberately not selected -- it is the raw geocoder payload
 * kept for auditing and re-derivation, not something any screen renders, and
 * pulling it would bloat every list query.
 *
 * How much comes back is decided by RLS, not by this hook: a staff member sees
 * only their own punches, while admin and finance see everyone's. So the same
 * page is correct for both without a client-side role check.
 */
export function useTimePunchesData() {
  const [punches, setPunches] = React.useState<TimePunch[]>([]);
  const [loading, setLoading] = React.useState(true);

  const refetch = React.useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .schema("ops")
      .from("time_punches")
      .select(
        "id, time_entry_id, staff_id, punch_type, punched_at, latitude, longitude, accuracy_meters, address_label, location_status, ip_address, user_agent, device_label, device_type"
      )
      .order("punched_at", { ascending: false });
    setPunches((data ?? []).map(toTimePunch));
    setLoading(false);
  }, []);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from Supabase, an external system
    refetch();
  }, [refetch]);

  return { punches, loading, refetch };
}
