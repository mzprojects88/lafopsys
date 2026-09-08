-- Reverses 0041: recreates the two retired tables (empty -- they always
-- were), restores 0015's blanket policy on ops.time_entries plus 0018's
-- inventory carve-outs, drops the HR punch policy and the roster view.

drop view if exists hr.v_roster;

drop policy if exists "hr reads all punches" on ops.time_punches;

drop policy if exists "staff read time entries" on ops.time_entries;
drop policy if exists "own time entry insert" on ops.time_entries;
drop policy if exists "own time entry update" on ops.time_entries;
drop policy if exists "own time entry delete" on ops.time_entries;
drop policy if exists "hr manage time entries" on ops.time_entries;

create policy "lafopsys staff full access" on ops.time_entries
  for all to authenticated
  using (shared.current_staff_role() in ('admin','social_worker','house_staff','driver','finance','board','volunteer'))
  with check (shared.current_staff_role() in ('admin','social_worker','house_staff','driver','finance','board','volunteer'));

create policy "inventory roles read own time entry" on ops.time_entries
  for select to authenticated
  using (staff_id = auth.uid() and shared.current_staff_role() in ('chef', 'inventory_staff', 'nutritionist', 'inventory_lead'));

create policy "inventory roles insert own time entry" on ops.time_entries
  for insert to authenticated
  with check (staff_id = auth.uid() and shared.current_staff_role() in ('chef', 'inventory_staff', 'nutritionist', 'inventory_lead'));

create policy "inventory roles update own time entry" on ops.time_entries
  for update to authenticated
  using (staff_id = auth.uid() and shared.current_staff_role() in ('chef', 'inventory_staff', 'nutritionist', 'inventory_lead'))
  with check (staff_id = auth.uid() and shared.current_staff_role() in ('chef', 'inventory_staff', 'nutritionist', 'inventory_lead'));

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

alter table ops.shifts enable row level security;
alter table ops.timesheet_approvals enable row level security;
create policy "lafopsys staff full access" on ops.shifts
  for all to authenticated
  using (shared.current_staff_role() in ('admin','social_worker','house_staff','driver','finance','board','volunteer'))
  with check (shared.current_staff_role() in ('admin','social_worker','house_staff','driver','finance','board','volunteer'));
create policy "lafopsys staff full access" on ops.timesheet_approvals
  for all to authenticated
  using (shared.current_staff_role() in ('admin','social_worker','house_staff','driver','finance','board','volunteer'))
  with check (shared.current_staff_role() in ('admin','social_worker','house_staff','driver','finance','board','volunteer'));
alter publication supabase_realtime add table ops.shifts;
alter publication supabase_realtime add table ops.timesheet_approvals;
