import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { reverseGeocode } from "@/lib/utils/geocode";
import { clientIpFromHeaders, parseUserAgent } from "@/lib/utils/device";
import { todayIso, nowTimeLabel } from "@/lib/utils/date";
import type { PunchLocationStatus } from "@/lib/types/staff";

const LOCATION_STATUSES: PunchLocationStatus[] = [
  "captured",
  "permission_denied",
  "unavailable",
  "geocode_failed",
];

interface PunchBody {
  punchType?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  accuracyMeters?: unknown;
  locationStatus?: unknown;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Records one clock-in or clock-out punch: the DTR row in `ops.time_punches`
 * (location + device + IP) and the matching daily summary in `ops.time_entries`
 * that the clock-in gate and timesheets read.
 *
 * Server-side because three of the four things it records can only be obtained
 * or trusted here: the IP comes from proxy headers, Nominatim's usage policy
 * requires an identifying User-Agent a browser cannot set, and the staff id must
 * come from the session rather than the request body -- otherwise anyone could
 * punch in as a colleague.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }

  // Confirms the caller is staff (not, say, a bare auth user with no roster row)
  // and gives a clear error rather than a foreign-key violation further down.
  const { data: staffRow } = await supabase
    .schema("shared")
    .from("staff")
    .select("id, active")
    .eq("id", user.id)
    .maybeSingle();

  if (!staffRow) {
    return NextResponse.json(
      { ok: false, error: "No staff record for this account, so there is nothing to clock." },
      { status: 403 }
    );
  }
  if (!staffRow.active) {
    return NextResponse.json({ ok: false, error: "This staff account is inactive." }, { status: 403 });
  }

  let body: PunchBody;
  try {
    body = (await request.json()) as PunchBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Malformed request body." }, { status: 400 });
  }

  const punchType = body.punchType === "clock_in" || body.punchType === "clock_out" ? body.punchType : null;
  if (!punchType) {
    return NextResponse.json(
      { ok: false, error: "punchType must be 'clock_in' or 'clock_out'." },
      { status: 400 }
    );
  }

  const latitude = finiteNumber(body.latitude);
  const longitude = finiteNumber(body.longitude);
  const accuracyMeters = finiteNumber(body.accuracyMeters);

  // Trust the client's reason for *not* having a location, but never its claim to
  // have one: "captured" only stands if usable coordinates actually arrived.
  const claimed = LOCATION_STATUSES.find((s) => s === body.locationStatus) ?? "unavailable";
  const hasCoordinates = latitude !== undefined && longitude !== undefined;
  let locationStatus: PunchLocationStatus = hasCoordinates ? "captured" : claimed === "captured" ? "unavailable" : claimed;

  let addressLabel: string | null = null;
  let addressJson: unknown = null;

  if (hasCoordinates) {
    const geocoded = await reverseGeocode(latitude, longitude);
    if (geocoded) {
      addressLabel = geocoded.addressLabel;
      addressJson = geocoded.raw;
    } else {
      // Coordinates are real, we just couldn't name them. Keep the coordinates and
      // say so, rather than inventing an address or discarding the fix.
      locationStatus = "geocode_failed";
    }
  }

  const date = todayIso();
  const time = nowTimeLabel();

  // ---- the daily summary row (unchanged shape; still what the gate reads) ----
  const { data: existing } = await supabase
    .schema("ops")
    .from("time_entries")
    .select("id")
    .eq("staff_id", user.id)
    .eq("date", date)
    .maybeSingle();

  let timeEntryId = existing?.id ?? null;

  if (punchType === "clock_in") {
    if (timeEntryId) {
      const { error } = await supabase
        .schema("ops")
        .from("time_entries")
        .update({ clock_in: time, clock_out: null })
        .eq("id", timeEntryId);
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    } else {
      const { data: inserted, error } = await supabase
        .schema("ops")
        .from("time_entries")
        .insert({ staff_id: user.id, date, clock_in: time })
        .select("id")
        .single();
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      timeEntryId = inserted.id;
    }
  } else {
    if (!timeEntryId) {
      return NextResponse.json(
        { ok: false, error: "No clock-in recorded today, so there is nothing to clock out of." },
        { status: 409 }
      );
    }
    const { error } = await supabase
      .schema("ops")
      .from("time_entries")
      .update({ clock_out: time })
      .eq("id", timeEntryId);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // ---- the DTR punch itself ----
  const userAgent = request.headers.get("user-agent");
  const device = parseUserAgent(userAgent);

  const { error: punchError } = await supabase.schema("ops").from("time_punches").insert({
    time_entry_id: timeEntryId,
    staff_id: user.id,
    punch_type: punchType,
    latitude: latitude ?? null,
    longitude: longitude ?? null,
    accuracy_meters: accuracyMeters ?? null,
    address_label: addressLabel,
    address_json: addressJson,
    location_status: locationStatus,
    ip_address: clientIpFromHeaders(request.headers) ?? null,
    user_agent: userAgent,
    device_label: device.label,
    device_type: device.type,
  });

  if (punchError) {
    // The summary already moved, so report the DTR gap explicitly rather than
    // letting the punch vanish silently.
    return NextResponse.json(
      { ok: false, error: `Clock recorded, but the DTR entry failed: ${punchError.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, timeEntryId, locationStatus, addressLabel, device: device.label });
}
