-- DTR (Daily Time Record): an append-only log of every individual clock-in and
-- clock-out punch, with where and on what device it happened.
--
-- Why a new table rather than more columns on ops.time_entries: that table is
-- `unique (staff_id, date)` -- one row per person per day -- and
-- lib/hooks/use-time-entries-collection.ts's clockIn() *overwrites* clock_in and
-- resets clock_out on a re-punch. So it is a daily summary by construction and
-- structurally cannot hold a history. It stays exactly as it is (the clock-in
-- gate, the roster status badges and /staff/timesheets all read it); this table
-- sits alongside it and records each punch as it happens.
--
-- ops.time_entries.gps_stamped is now superseded by time_punches.location_status,
-- which records *why* a location is missing rather than just that it is. The
-- column is left in place rather than dropped -- lib/types/staff.ts and the
-- timesheets hook still map it -- but nothing new should write to it.

create table ops.time_punches (
  id uuid primary key default gen_random_uuid(),
  -- The daily summary row this punch contributed to. Cascades so deleting a day's
  -- entry doesn't strand its punches.
  time_entry_id uuid references ops.time_entries (id) on delete cascade,
  staff_id uuid not null references shared.staff (id),
  punch_type text not null check (punch_type in ('clock_in', 'clock_out')),
  punched_at timestamptz not null default now(),

  -- ---------- location ----------
  -- All four location columns are nullable on purpose. A punch with no location is
  -- a valid punch: geolocation is a browser permission the staff member can refuse,
  -- and refusing must never stop someone clocking in (the clock-in gate would then
  -- lock them out of the whole app). location_status records which of those
  -- happened, so "no address" is never ambiguous between "denied", "device
  -- couldn't get a fix" and "we had coordinates but couldn't name them".
  latitude double precision,
  longitude double precision,
  accuracy_meters double precision,
  -- Human-readable full address from reverse geocoding, e.g.
  -- "12 Banawe St, Barangay Santa Teresita, Quezon City, Metro Manila, 1114".
  -- Null whenever location_status is anything other than 'captured'.
  address_label text,
  -- Raw geocoder response kept verbatim, so a better address can be re-derived
  -- later without re-querying, and so the label can be audited against its source.
  address_json jsonb,
  location_status text not null default 'unavailable' check (
    location_status in ('captured', 'permission_denied', 'unavailable', 'geocode_failed')
  ),

  -- ---------- device ----------
  -- The public IP the punch arrived from. This is what "device address" can
  -- actually mean on the web: a browser cannot read a MAC address, there is no API
  -- for it at any permission level. Recorded server-side from x-forwarded-for --
  -- a client cannot be trusted to report its own address.
  ip_address inet,
  user_agent text,
  -- Friendly summary parsed from user_agent, e.g. "iPhone · Safari · iOS 17".
  -- user_agent is kept verbatim above so this can be re-parsed if the label proves
  -- wrong for some device.
  device_label text,
  device_type text not null default 'unknown' check (
    device_type in ('mobile', 'tablet', 'desktop', 'unknown')
  ),

  created_at timestamptz not null default now()
);

create index on ops.time_punches (staff_id, punched_at desc);
create index on ops.time_punches (punched_at desc);
create index on ops.time_punches (time_entry_id);

-- ---------- row level security ----------
-- Deliberately tighter than the blanket "any lafopsys staff, full access" policy
-- migration 0015 applies to the rest of ops.*. This table holds staff members'
-- physical whereabouts over time, which is personal data under the Data Privacy
-- Act of 2012 (RA 10173) and has no business being readable by every colleague.
--
-- Read: your own punches always; admin and finance see everyone (finance runs
-- payroll off timesheets and needs the same window).
-- Write: only ever your own rows, and in practice only through
-- app/api/dtr/punch/route.ts, which takes staff_id from the session rather than
-- the request body.
alter table ops.time_punches enable row level security;

create policy "read own punches" on ops.time_punches
  for select
  to authenticated
  using (staff_id = auth.uid());

create policy "admin and finance read all punches" on ops.time_punches
  for select
  to authenticated
  using (shared.current_staff_role() in ('admin', 'finance'));

create policy "insert own punches" on ops.time_punches
  for insert
  to authenticated
  with check (staff_id = auth.uid());

-- No update or delete policy: a time record that can be quietly edited after the
-- fact is not a time record. Corrections go through the existing
-- ops.timesheet_approvals adjustment-reason flow against the daily entry.
