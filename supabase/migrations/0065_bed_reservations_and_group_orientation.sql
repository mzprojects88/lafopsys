-- Admission, reworked (user, 2026-09-25).
--
-- 1. A bed can be RESERVED for a child who has not arrived yet: a hold, not
--    a stay. Nothing about the house changes (no stay, no bed night, not in
--    the census); the bed is simply not offered to anyone else, and when the
--    child arrives Check in opens on it to be confirmed or changed. Released
--    by hand if plans change; closed as "used" by the check-in.
--
-- 2. The house rules are the last step before a child is checked in. A
--    family that came with others -- one LAF HOPE pick-up, or one shared
--    ride -- can hear them together: the first check-in of the group records
--    that the rules were discussed with the group, and the rest of that
--    group are checked in on it.

create table ops.bed_reservations (
  id uuid primary key default gen_random_uuid(),
  unit_id text not null references ops.units (id),
  patient_id uuid references ops.patients (id) on delete cascade,
  house_sheet_person_id uuid references ops.house_sheet_people (id) on delete set null,
  -- The name as staff know it now (a sheet name before there is a record).
  reserved_for text not null check (btrim(reserved_for) <> ''),
  expected_on date not null,
  note text,
  status text not null default 'active' check (status in ('active', 'used', 'released')),
  used_stay_id uuid references ops.stays (id) on delete set null,
  created_by uuid references shared.staff (id) default auth.uid(),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  check (patient_id is not null or house_sheet_person_id is not null),
  check ((status = 'active') = (closed_at is null))
);

-- One bed held per child at a time.
create unique index bed_reservations_one_per_patient on ops.bed_reservations (patient_id) where status = 'active' and patient_id is not null;
create unique index bed_reservations_one_per_sheet_person on ops.bed_reservations (house_sheet_person_id) where status = 'active' and house_sheet_person_id is not null;
create index bed_reservations_active_unit on ops.bed_reservations (unit_id) where status = 'active';

alter table ops.bed_reservations enable row level security;
create policy "patients and house viewers read reservations" on ops.bed_reservations
  for select to authenticated using (shared.module_viewable('patients', 'house_ops'));
create policy "patients editors reserve" on ops.bed_reservations
  for insert to authenticated with check (shared.module_editable('patients') and status = 'active');
create policy "patients editors close reservations" on ops.bed_reservations
  for update to authenticated using (shared.module_editable('patients')) with check (shared.module_editable('patients'));
revoke all on ops.bed_reservations from anon, authenticated;
grant select, insert, update on ops.bed_reservations to authenticated;
alter publication supabase_realtime add table ops.bed_reservations;

create table ops.group_orientations (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references ops.trips (id) on delete cascade,
  ride_id uuid references ops.arrival_rides (id) on delete cascade,
  held_at timestamptz not null default now(),
  held_by uuid references shared.staff (id) default auth.uid(),
  check (num_nonnulls(trip_id, ride_id) = 1)
);
create unique index group_orientations_one_per_trip on ops.group_orientations (trip_id) where trip_id is not null;
create unique index group_orientations_one_per_ride on ops.group_orientations (ride_id) where ride_id is not null;

alter table ops.group_orientations enable row level security;
create policy "patients viewers read group orientations" on ops.group_orientations
  for select to authenticated using (shared.module_viewable('patients'));
create policy "patients editors record group orientations" on ops.group_orientations
  for insert to authenticated with check (shared.module_editable('patients'));
revoke all on ops.group_orientations from anon, authenticated;
grant select, insert on ops.group_orientations to authenticated;
alter publication supabase_realtime add table ops.group_orientations;

notify pgrst, 'reload schema';
