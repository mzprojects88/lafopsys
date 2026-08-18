-- Phase 5: staff timekeeping + volunteers + analytics snapshot tables.
--
-- Provenance (read from lib/mock-data/staff.ts before writing this migration):
--   staff (12 entries)        -- real names/roles/positions/hire dates, but NOT
--                                 migrated here. shared.staff.id = auth.users.id
--                                 (migration 0001), so a row can't exist without a
--                                 real login account + PIN. Creating those 12
--                                 accounts is an admin-provisioning task (per the
--                                 Phase 0 decision), not something a migration
--                                 script can do. shared.staff already exists and
--                                 is the real source for staff identity.
--   shifts/timeEntries/timesheetApprovals -- 100% rng-fabricated in a 14-day
--                                 generation loop, no real source. Start empty.
--   volunteers (5 entries)    -- fixed demo names/hours/certs with only
--                                 lastSessionDate rng-generated. No real source
--                                 file exists (lib/mock-data/real/ has no
--                                 volunteers.json, unlike patients/donors/cash
--                                 entries). Start empty.
--   metricSnapshots (6 entries) -- real data, lib/mock-data/real/metric-snapshots.json,
--                                 produced in integrate.md Step 3. Migrated below.

create table ops.shifts (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references shared.staff (id),
  date date not null,
  start_time text not null,
  end_time text not null,
  label text not null check (label in ('AM', 'PM', 'Night', '24hr')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table ops.time_entries (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references shared.staff (id),
  date date not null,
  clock_in text,
  clock_out text,
  break_minutes integer not null default 0,
  flag text not null default 'on_time' check (flag in ('on_time', 'late', 'early_out', 'missed_punch')),
  overtime_minutes integer not null default 0,
  gps_stamped boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (staff_id, date)
);

create table ops.timesheet_approvals (
  id uuid primary key default gen_random_uuid(),
  time_entry_id uuid not null references ops.time_entries (id) on delete cascade,
  staff_id uuid not null references shared.staff (id),
  status text not null default 'pending' check (status in ('pending', 'approved', 'flagged', 'rejected')),
  adjustment_reason text,
  reviewed_by uuid references shared.staff (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table ops.volunteers (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  focus_area text not null check (focus_area in ('Care Cart', 'Activity Center', 'Transport', 'Events')),
  total_hours numeric not null default 0,
  last_session_date date,
  certificates_issued integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table ops.metric_snapshots (
  date date primary key,
  bed_nights integer not null,
  meals integer not null,
  trips integer not null,
  care_cart_meals integer not null,
  activity_participants integer not null,
  donations_ytd numeric not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
declare
  t text;
begin
  foreach t in array array['shifts', 'time_entries', 'timesheet_approvals', 'volunteers', 'metric_snapshots']
  loop
    execute format('alter table ops.%I enable row level security', t);
    execute format(
      'create policy "authenticated staff full access" on ops.%I for all to authenticated using (true) with check (true)',
      t
    );
    execute format(
      'create trigger set_updated_at before update on ops.%I for each row execute function shared.set_updated_at()',
      t
    );
  end loop;
end $$;
