-- Phase 2: House Operations (trips, meals, care cart, activity center, census).
-- Real historical data exists for meal_services (82 rows), care_cart_logs (46
-- rows), and census_snapshots (248 rows) -- see integrate.md and
-- lib/mock-data/house-ops.ts's own provenance comments. trips and
-- activity_sessions have NO real source data (lib/mock-data/house-ops.ts
-- generates both with `rng`, confirmed by reading the generator) -- both
-- start empty per the same don't-fabricate discipline as orientation_topics,
-- staff record real ones going forward through the app.

create table ops.trips (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  direction text not null check (direction in ('to_hospital', 'from_hospital', 'errand', 'other')),
  driver_staff_id uuid references shared.staff (id),
  vehicle text not null,
  departure_time text not null,
  return_time text,
  odometer_start integer,
  odometer_end integer,
  fuel_cost numeric(10, 2),
  status text not null check (status in ('scheduled', 'in_progress', 'completed')) default 'scheduled',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table ops.trip_passengers (
  trip_id uuid not null references ops.trips (id) on delete cascade,
  patient_id uuid not null references ops.patients (id) on delete cascade,
  primary key (trip_id, patient_id)
);

create table ops.meal_services (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  meal_type text not null check (meal_type in ('breakfast', 'lunch', 'dinner')),
  headcount integer not null,
  -- No per-meal cost in the real Care Cart sheet -- null for real data, not fabricated.
  cost_per_head numeric(10, 2),
  created_at timestamptz not null default now(),
  unique (date, meal_type)
);

create table ops.meal_service_exceptions (
  id uuid primary key default gen_random_uuid(),
  meal_service_id uuid not null references ops.meal_services (id) on delete cascade,
  patient_id uuid not null references ops.patients (id) on delete cascade,
  reason text not null
);

create table ops.care_cart_logs (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  -- "10:00 & 14:00" covers the real ledger's own combined-window rows, which
  -- don't split per slot -- kept as free text rather than an enum so it isn't
  -- artificially constrained to the demo-data slot set.
  time_slot text not null,
  items_served text not null,
  headcount integer not null,
  -- No volunteers/source table exists yet (volunteers are Phase 5 scope) --
  -- left as plain nullable columns, no FK, until that entity is real.
  volunteer_id text,
  source text check (source in ('LAF Pantry', 'Donation')),
  created_at timestamptz not null default now()
);

create table ops.activity_sessions (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  title text not null,
  participants integer not null default 0,
  volunteer_count integer not null default 0,
  facilitator text,
  hours numeric(4, 2) not null default 0,
  created_at timestamptz not null default now()
);

-- One row per day, matching the real Occupancy Tracker's own grain -- see
-- CensusSnapshot's doc comment for why units_occupied/units_shared are null
-- for real (name-only-roster) days.
create table ops.census_snapshots (
  date date primary key,
  in_house integer not null,
  units_occupied integer,
  units_shared integer,
  total_units integer not null default 13
);

alter table ops.trips enable row level security;
alter table ops.trip_passengers enable row level security;
alter table ops.meal_services enable row level security;
alter table ops.meal_service_exceptions enable row level security;
alter table ops.care_cart_logs enable row level security;
alter table ops.activity_sessions enable row level security;
alter table ops.census_snapshots enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'trips', 'trip_passengers', 'meal_services', 'meal_service_exceptions',
    'care_cart_logs', 'activity_sessions', 'census_snapshots'
  ]
  loop
    execute format(
      'create policy "authenticated staff full access" on ops.%I for all to authenticated using (true) with check (true)',
      t
    );
  end loop;
end $$;

create trigger set_updated_at before update on ops.trips for each row execute function shared.set_updated_at();

create index on ops.trips (date);
create index on ops.meal_services (date);
create index on ops.care_cart_logs (date);
