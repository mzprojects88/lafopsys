import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { reverseGeocode } from "@/lib/utils/geocode";
import { clientIpFromHeaders, parseUserAgent } from "@/lib/utils/device";
import { todayIso, nowTimeLabel } from "@/lib/utils/date";
import { addDays, entryTotals, pairSessions, zonedDayStart } from "@/lib/utils/dtr";
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
 * A day can have any number of sessions. The summary keeps the day's first
 * clock_in, its latest clock_out (null while clocked in) and the totals;
 * every session is in the punches. Decision table:
 *   clock_in  | open entry (today/yesterday)  -> 409
 *   clock_in  | today's entry, closed         -> reopen (clock_out = null)
 *   clock_in  | no entry                      -> insert
 *   clock_out | no open entry                 -> 409 (covers double clock-out)
 *   clock_out | open entry                    -> close it (may be yesterday's)
 * then insert the punch, then recompute the day's totals from its punches.
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

  const today = todayIso();
  const yesterday = addDays(today, -1);
  const time = nowTimeLabel();

  // ---- clock state lives on the daily summary (what the gate and roster read) ----
  // "Open" = clocked in and not yet out, today OR yesterday: a Night/24hr shift
  // crosses midnight and must still be closable after it. Same rule as
  // use-clock-status.ts. Anything older than that is a forgotten clock-out.
  const { data: recent, error: recentError } = await supabase
    .schema("ops")
    .from("time_entries")
    .select("id, date, clock_in, clock_out")
    .eq("staff_id", user.id)
    .in("date", [today, yesterday])
    .order("date", { ascending: false });
  if (recentError) return NextResponse.json({ ok: false, error: recentError.message }, { status: 500 });

  type RecentEntry = { id: string; date: string; clock_in: string | null; clock_out: string | null };
  const todayEntry = ((recent ?? []) as RecentEntry[]).find((e) => e.date === today) ?? null;
  const openEntry = ((recent ?? []) as RecentEntry[]).find((e) => !!e.clock_in && !e.clock_out) ?? null;

  let entryId: string;
  let entryDay: string;
  // Undoes the summary write if the punch insert right after it fails, so the
  // summary never claims a session the DTR doesn't have.
  let revert: (() => Promise<void>) | null = null;

  if (punchType === "clock_in") {
    if (openEntry) {
      const when = openEntry.date === yesterday ? `${openEntry.clock_in} yesterday` : openEntry.clock_in;
      return NextResponse.json({ ok: false, error: `Already clocked in at ${when}.` }, { status: 409 });
    }
    if (todayEntry) {
      // Clocked out earlier today: reopen the day. clock_in keeps the day's first
      // time; the session that just ended is safe in the punches.
      const { error } = await supabase.schema("ops").from("time_entries").update({ clock_out: null }).eq("id", todayEntry.id);
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      entryId = todayEntry.id;
      const previousOut = todayEntry.clock_out;
      revert = async () => {
        await supabase.schema("ops").from("time_entries").update({ clock_out: previousOut }).eq("id", todayEntry.id);
      };
    } else {
      const { data: inserted, error } = await supabase
        .schema("ops")
        .from("time_entries")
        .insert({ staff_id: user.id, date: today, clock_in: time })
        .select("id")
        .single();
      if (error) {
        // unique (staff_id, date): two devices raced to create the day. One won;
        // this one is a duplicate tap.
        if (error.code === "23505") return NextResponse.json({ ok: false, error: "Already clocked in." }, { status: 409 });
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }
      entryId = inserted.id as string;
      revert = async () => {
        await supabase.schema("ops").from("time_entries").delete().eq("id", inserted.id);
      };
    }
    entryDay = today;

    // A day left open before yesterday is a forgotten clock-out. Flag it for the
    // timesheet queue; never block today's clock-in on it. Best effort.
    await supabase
      .schema("ops")
      .from("time_entries")
      .update({ flag: "missed_punch" })
      .eq("staff_id", user.id)
      .lt("date", yesterday)
      .is("clock_out", null)
      .not("clock_in", "is", null)
      .neq("flag", "missed_punch");
  } else {
    if (!openEntry) {
      return NextResponse.json({ ok: false, error: "You're not clocked in." }, { status: 409 });
    }
    entryId = openEntry.id;
    entryDay = openEntry.date;
  }

  // ---- the DTR punch itself ----
  const userAgent = request.headers.get("user-agent");
  const device = parseUserAgent(userAgent);

  const { error: punchError } = await supabase.schema("ops").from("time_punches").insert({
    time_entry_id: entryId,
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
    if (revert) await revert();
    return NextResponse.json({ ok: false, error: `The punch could not be recorded: ${punchError.message}` }, { status: 500 });
  }

  // ---- the day's totals, from the punches (the only source of duration) ----
  // Window = the entry's day plus the next, so an overnight session's clock-out
  // is in range; sessions belong to the day they were clocked in.
  const { data: punchRows } = await supabase
    .schema("ops")
    .from("time_punches")
    .select("id, staff_id, punch_type, punched_at, time_entry_id")
    .eq("staff_id", user.id)
    .gte("punched_at", zonedDayStart(entryDay).toISOString())
    .lt("punched_at", zonedDayStart(addDays(entryDay, 2)).toISOString());
  type PunchRowLite = { id: string; staff_id: string; punch_type: "clock_in" | "clock_out"; punched_at: string; time_entry_id: string | null };
  const sessions = pairSessions(
    ((punchRows ?? []) as PunchRowLite[]).map((r) => ({
      id: r.id,
      staffId: r.staff_id,
      punchType: r.punch_type,
      punchedAt: r.punched_at,
      timeEntryId: r.time_entry_id ?? undefined,
    }))
  );
  const totals = entryTotals(sessions, entryDay, user.id);

  const { error: summaryError } = await supabase
    .schema("ops")
    .from("time_entries")
    .update({
      ...(punchType === "clock_out" ? { clock_out: time } : {}),
      total_minutes: totals.totalMinutes,
      session_count: totals.sessionCount,
    })
    .eq("id", entryId);
  if (summaryError) {
    // The punch is in the DTR; only the summary lags. Say exactly that.
    return NextResponse.json(
      { ok: false, error: `Punch recorded, but the daily summary failed: ${summaryError.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    timeEntryId: entryId,
    locationStatus,
    addressLabel,
    device: device.label,
    totalMinutesToday: totals.totalMinutes,
    sessionCount: totals.sessionCount,
  });
}
