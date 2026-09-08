-- Time becomes pay through three tables.
--
-- hr.pay_periods: the semi-monthly calendar (1st-15th, 16th-end; Labor
-- Code Art. 103), generated a year at a time by HR from
-- lib/utils/pay-period.ts with the pay date from the rule in
-- shared.app_settings (0038). The pay date is editable per row for the
-- odd case (a holiday declared late, a bank problem). Status walks
-- open -> timesheets_approved -> computed -> approved -> paid -> closed;
-- 0042's payroll runs move it from `computed` on.
--
-- hr.period_timesheets: one row per employee per period. `summary` is the
-- PeriodAttendance that lib/utils/attendance.ts computed from the
-- schedule, the DTR sessions, the holidays and the approved leaves,
-- FROZEN at approval. Payroll reads this row and nothing else, so what
-- was approved is what is paid; a punch corrected after approval needs
-- the timesheet reopened and re-approved (status `reopened`, logged).
-- This replaces ops.timesheet_approvals (per day, never written) which
-- 0041 drops.
--
-- hr.schedule_overrides: one day's departure from the weekly pattern in
-- hr.work_schedules -- a swapped rest day, a 24-hour house duty, a night
-- shift. What /staff/roster shows and edits from now on; ops.shifts
-- (never written) goes in 0041.

create table hr.pay_periods (
  id uuid primary key default gen_random_uuid(),
  year integer not null check (year between 2020 and 2100),
  seq integer not null check (seq between 1 and 24),
  starts_on date not null,
  ends_on date not null,
  pay_date date not null,
  status text not null default 'open'
    check (status in ('open', 'timesheets_approved', 'computed', 'approved', 'paid', 'closed')),
  notes text,
  created_by uuid references shared.staff (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (year, seq),
  check (ends_on >= starts_on),
  check (pay_date >= ends_on - 15)
);

alter table hr.pay_periods enable row level security;

-- Everyone can see the calendar -- when the next pay date is is not a
-- secret; only HR shapes it.
create policy "staff read pay periods" on hr.pay_periods
  for select to authenticated
  using (shared.current_staff_role() is not null);

create policy "hr manage pay periods" on hr.pay_periods
  for all to authenticated
  using (hr.is_hr_staff())
  with check (hr.is_hr_staff());

create trigger set_updated_at
  before update on hr.pay_periods
  for each row execute function shared.set_updated_at();

alter publication supabase_realtime add table hr.pay_periods;

-- ---------------------------------------------------------------------------

create table hr.period_timesheets (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references hr.pay_periods (id) on delete cascade,
  employee_id uuid not null references hr.employees (id) on delete cascade,
  status text not null default 'draft' check (status in ('draft', 'approved', 'reopened')),
  -- lib/utils/attendance.ts PeriodAttendance, frozen at approval.
  summary jsonb not null default '{}'::jsonb,
  approved_by uuid references shared.staff (id),
  approved_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (period_id, employee_id),
  check ((status = 'approved') = (approved_at is not null))
);

create index period_timesheets_employee_idx on hr.period_timesheets (employee_id, period_id);

alter table hr.period_timesheets enable row level security;

create policy "hr manage period timesheets" on hr.period_timesheets
  for all to authenticated
  using (hr.is_hr_staff())
  with check (hr.is_hr_staff());

create policy "own period timesheets" on hr.period_timesheets
  for select to authenticated
  using (employee_id = hr.current_employee_id());

create trigger set_updated_at
  before update on hr.period_timesheets
  for each row execute function shared.set_updated_at();

alter publication supabase_realtime add table hr.period_timesheets;

-- ---------------------------------------------------------------------------

create table hr.schedule_overrides (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references hr.employees (id) on delete cascade,
  date date not null,
  -- null start/end with is_rest_day = true is a rest day; end < start is an
  -- overnight shift belonging to this date (the DTR's own convention).
  start_time time,
  end_time time,
  is_rest_day boolean not null default false,
  reason text,
  created_by uuid references shared.staff (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, date),
  check (is_rest_day or (start_time is not null and end_time is not null and start_time <> end_time))
);

create index schedule_overrides_date_idx on hr.schedule_overrides (date);

alter table hr.schedule_overrides enable row level security;

-- The roster is read by everyone on duty; written by HR.
create policy "staff read schedule overrides" on hr.schedule_overrides
  for select to authenticated
  using (shared.current_staff_role() is not null);

create policy "hr manage schedule overrides" on hr.schedule_overrides
  for all to authenticated
  using (hr.is_hr_staff())
  with check (hr.is_hr_staff());

create trigger set_updated_at
  before update on hr.schedule_overrides
  for each row execute function shared.set_updated_at();

alter publication supabase_realtime add table hr.schedule_overrides;
