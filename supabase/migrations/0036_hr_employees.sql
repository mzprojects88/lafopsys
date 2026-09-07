-- The employee master: what DATA/Employee Data.xlsx ("Employee 201
-- Masterlist") holds today, as tables the rest of HR can compute from.
--
-- Shape decisions, each with a reason:
--
-- * hr.employees has its own id; staff_id is a nullable, unique link to
--   shared.staff. A 201 record exists for people with no login (the resigned
--   row in the masterlist, someone hired but not yet onboarded) and, the
--   other way round, an account can exist before HR has filed the person.
--   Own-row policies therefore go through hr.current_employee_id(), never a
--   bare `staff_id = auth.uid()`.
--
-- * hr.employee_private holds the government ID numbers and bank details on
--   their own. Sensitive personal information under the Data Privacy Act
--   (RA 10173, s.3(l)); readable only by HR and the person themselves, and
--   deliberately NOT in the realtime publication, so no list screen ever
--   receives these columns by accident.
--
-- * Employment status is a history (hr.employment_events), denormalised onto
--   hr.employees by trigger. Probation, regularisation, separation and the
--   cause of separation all carry dates and reasons the law cares about
--   (Art. 296 probation <= 6 months; Arts. 298-299 authorised causes and
--   their separation pay; final pay within 30 days, LA 06-20).
--
-- * Compensation and work schedules are effective-dated and may not overlap
--   per person (gist exclusion over employee_id x daterange). A BEFORE INSERT
--   trigger closes the open predecessor at the new row's start, so "give this
--   person a raise from Oct 1" is one insert through PostgREST, not a
--   two-statement transaction the client cannot express.
--
-- * Pay basis is per person: fixed monthly (the default -- every row of the
--   masterlist is paid semi-monthly on a monthly basic) or a daily rate. The
--   daily equivalent of a monthly rate is monthly x 12 / days_factor; 365 is
--   DOLE's factor for employees paid every day of the year including rest
--   days and holidays, 313 and 261 for those who are not (Handbook on
--   Workers' Statutory Monetary Benefits).

-- ---------------------------------------------------------------------------
-- Employees
-- ---------------------------------------------------------------------------

create table hr.employees (
  id uuid primary key default gen_random_uuid(),
  employee_code text not null unique,                           -- EMP-30xx, from the masterlist
  staff_id uuid unique references shared.staff (id),
  first_name text not null,
  middle_name text,
  last_name text not null,
  suffix text,
  position text not null,
  department text,
  employment_type text not null default 'probationary'
    check (employment_type in ('probationary', 'regular', 'contractual', 'part_time', 'casual')),
  status text not null default 'active'
    check (status in ('active', 'on_leave', 'resigned', 'terminated')),
  hire_date date not null,
  regularization_date date,
  separation_date date,
  birthdate date,
  sex text check (sex is null or sex in ('female', 'male')),
  civil_status text,
  contact_number text,
  email text,
  address text,
  emergency_contact jsonb not null default '{}'::jsonb,        -- {name, relationship, phone, address}
  notes text,
  created_by uuid references shared.staff (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (separation_date is null or separation_date >= hire_date),
  check (regularization_date is null or regularization_date >= hire_date)
);

create index employees_last_first_idx on hr.employees (last_name, first_name);

-- "Me" for every own-row policy in this schema. Definer so the lookup works
-- before the caller has any policy of their own on hr.employees, and
-- active-only like shared.current_staff_role() (0026): a deactivated
-- account stops seeing its own file on its next request.
create or replace function hr.current_employee_id()
returns uuid
language sql
security definer
set search_path = hr, shared, pg_temp
stable
as $$
  select e.id
  from hr.employees e
  join shared.staff s on s.id = e.staff_id
  where s.id = auth.uid() and s.active;
$$;

grant execute on function hr.current_employee_id() to authenticated, service_role;

alter table hr.employees enable row level security;

create policy "hr manage employees" on hr.employees
  for all to authenticated
  using (hr.is_hr_staff())
  with check (hr.is_hr_staff());

create policy "own employee record" on hr.employees
  for select to authenticated
  using (id = hr.current_employee_id());

create trigger set_updated_at
  before update on hr.employees
  for each row execute function shared.set_updated_at();

alter publication supabase_realtime add table hr.employees;

-- ---------------------------------------------------------------------------
-- Private identifiers (RA 10173 sensitive personal information)
-- ---------------------------------------------------------------------------

create table hr.employee_private (
  employee_id uuid primary key references hr.employees (id) on delete cascade,
  sss_no text,
  philhealth_no text,
  pagibig_no text,
  tin text,
  bank_name text,
  bank_account_name text,
  bank_account_no text,
  updated_by uuid references shared.staff (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table hr.employee_private enable row level security;

create policy "hr manage private" on hr.employee_private
  for all to authenticated
  using (hr.is_hr_staff())
  with check (hr.is_hr_staff());

create policy "own private record" on hr.employee_private
  for select to authenticated
  using (employee_id = hr.current_employee_id());

create trigger set_updated_at
  before update on hr.employee_private
  for each row execute function shared.set_updated_at();

-- No publication line: this table is fetched per person, on demand, never
-- streamed to a client-side collection.

-- ---------------------------------------------------------------------------
-- Employment history
-- ---------------------------------------------------------------------------

create table hr.employment_events (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references hr.employees (id) on delete cascade,
  kind text not null
    check (kind in ('hired', 'regularized', 'status_change', 'position_change', 'separated', 'rehired')),
  effective_on date not null,
  employment_type text
    check (employment_type is null or employment_type in ('probationary', 'regular', 'contractual', 'part_time', 'casual')),
  status text
    check (status is null or status in ('active', 'on_leave', 'resigned', 'terminated')),
  position text,
  -- Arts. 297-299 and Art. 300 of the Labor Code; the cause decides
  -- separation pay (1 month/year for redundancy, 1/2 month/year for
  -- retrenchment, closure and disease; none for just cause or resignation).
  separation_cause text
    check (separation_cause is null or separation_cause in
      ('resignation', 'end_of_contract', 'redundancy', 'retrenchment', 'closure', 'disease', 'just_cause', 'retirement', 'death')),
  reason text,
  created_by uuid references shared.staff (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind <> 'separated' or separation_cause is not null)
);

create index employment_events_employee_idx on hr.employment_events (employee_id, effective_on desc);

-- Keep the denormalised columns on hr.employees in step with the latest
-- event. Only the most recent event by effective date speaks; an event
-- back-dated behind a later one changes nothing on the employee row.
create or replace function hr.apply_employment_event()
returns trigger
language plpgsql
security definer
set search_path = hr, pg_temp
as $$
declare
  latest hr.employment_events%rowtype;
begin
  select * into latest
  from hr.employment_events
  where employee_id = new.employee_id
  order by effective_on desc, created_at desc
  limit 1;

  if latest.id = new.id then
    update hr.employees
    set employment_type = coalesce(new.employment_type, employment_type),
        status = coalesce(new.status,
                          case new.kind
                            when 'separated' then case when new.separation_cause in ('resignation', 'retirement', 'death') then 'resigned' else 'terminated' end
                            when 'rehired' then 'active'
                            when 'hired' then 'active'
                            else status
                          end),
        position = coalesce(new.position, position),
        regularization_date = case when new.kind = 'regularized' then new.effective_on else regularization_date end,
        separation_date = case when new.kind = 'separated' then new.effective_on
                               when new.kind = 'rehired' then null
                               else separation_date end,
        hire_date = case when new.kind in ('hired', 'rehired') then new.effective_on else hire_date end
    where id = new.employee_id;
  end if;
  return new;
end;
$$;

create trigger apply_employment_event
  after insert on hr.employment_events
  for each row execute function hr.apply_employment_event();

alter table hr.employment_events enable row level security;

create policy "hr manage employment events" on hr.employment_events
  for all to authenticated
  using (hr.is_hr_staff())
  with check (hr.is_hr_staff());

create policy "own employment events" on hr.employment_events
  for select to authenticated
  using (employee_id = hr.current_employee_id());

create trigger set_updated_at
  before update on hr.employment_events
  for each row execute function shared.set_updated_at();

alter publication supabase_realtime add table hr.employment_events;

-- ---------------------------------------------------------------------------
-- Compensation (effective-dated)
-- ---------------------------------------------------------------------------

create table hr.compensation (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references hr.employees (id) on delete cascade,
  effective_from date not null,
  effective_to date,                                            -- exclusive; null = current
  pay_basis text not null default 'monthly' check (pay_basis in ('monthly', 'daily')),
  basic_monthly numeric(12, 2) check (basic_monthly is null or basic_monthly >= 0),
  daily_rate numeric(12, 2) check (daily_rate is null or daily_rate >= 0),
  days_factor integer not null default 365 check (days_factor in (365, 313, 261)),
  hours_per_day numeric(4, 2) not null default 8 check (hours_per_day > 0 and hours_per_day <= 12),
  -- [{code, label, amount_monthly, tax: 'taxable' | 'de_minimis', de_minimis_kind?}]
  -- De minimis benefits within RR 11-2018's limits are tax-exempt; anything
  -- else an employer pays on top of basic is taxable compensation.
  allowances jsonb not null default '[]'::jsonb,
  -- Minimum wage earners are exempt from income tax and withholding
  -- (NIRC s.24(A)(2), TRAIN). Set by HR only when the person is paid exactly
  -- the statutory minimum; the payroll engine warns when the flag and the
  -- rate disagree.
  is_minimum_wage_earner boolean not null default false,
  reason text,
  created_by uuid references shared.staff (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from),
  check (
    (pay_basis = 'monthly' and basic_monthly is not null)
    or (pay_basis = 'daily' and daily_rate is not null)
  ),
  constraint compensation_no_overlap
    exclude using gist (employee_id with =, daterange(effective_from, effective_to, '[)') with &&)
);

create index compensation_employee_idx on hr.compensation (employee_id, effective_from desc);

-- Close the open predecessor at the new row's start, so a new rate is one
-- insert. Refuses a row dated before an existing later row (history is
-- appended, never spliced -- correct a mistake by inserting the right row
-- from today, or by editing the wrong row directly).
create or replace function hr.close_previous_effective_row()
returns trigger
language plpgsql
as $$
declare
  later_exists boolean;
begin
  execute format(
    'select exists (select 1 from hr.%I where employee_id = $1 and effective_from >= $2)',
    tg_table_name
  ) into later_exists using new.employee_id, new.effective_from;

  if later_exists then
    raise exception 'A later % row already exists for this person; new rows must start after it', tg_table_name
      using errcode = '23P01';
  end if;

  execute format(
    'update hr.%I set effective_to = $2 where employee_id = $1 and effective_to is null and effective_from < $2',
    tg_table_name
  ) using new.employee_id, new.effective_from;
  return new;
end;
$$;

create trigger close_previous_compensation
  before insert on hr.compensation
  for each row execute function hr.close_previous_effective_row();

alter table hr.compensation enable row level security;

create policy "hr manage compensation" on hr.compensation
  for all to authenticated
  using (hr.is_hr_staff())
  with check (hr.is_hr_staff());

create policy "own compensation" on hr.compensation
  for select to authenticated
  using (employee_id = hr.current_employee_id());

create trigger set_updated_at
  before update on hr.compensation
  for each row execute function shared.set_updated_at();

alter publication supabase_realtime add table hr.compensation;

-- ---------------------------------------------------------------------------
-- Work schedules (effective-dated weekly pattern)
-- ---------------------------------------------------------------------------

create table hr.work_schedules (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references hr.employees (id) on delete cascade,
  effective_from date not null,
  effective_to date,
  -- {"mon": {"start": "08:00", "end": "17:00"}, ..., "sun": null}; a null
  -- day is a rest day (Art. 91: at least 24 consecutive hours after six
  -- days' work). end < start is an overnight shift belonging to its start day.
  pattern jsonb not null,
  break_minutes integer not null default 60 check (break_minutes >= 0 and break_minutes <= 240),   -- Art. 85: >= 60 min meal, unpaid
  hours_per_day numeric(4, 2) not null default 8 check (hours_per_day > 0 and hours_per_day <= 12), -- Art. 83
  reason text,
  created_by uuid references shared.staff (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from),
  check (pattern ?& array['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']),
  constraint work_schedules_no_overlap
    exclude using gist (employee_id with =, daterange(effective_from, effective_to, '[)') with &&)
);

create index work_schedules_employee_idx on hr.work_schedules (employee_id, effective_from desc);

create trigger close_previous_work_schedule
  before insert on hr.work_schedules
  for each row execute function hr.close_previous_effective_row();

alter table hr.work_schedules enable row level security;

create policy "hr manage work schedules" on hr.work_schedules
  for all to authenticated
  using (hr.is_hr_staff())
  with check (hr.is_hr_staff());

-- Everyone on staff can read schedules: the roster on /staff is who is on
-- duty today, not a secret.
create policy "staff read work schedules" on hr.work_schedules
  for select to authenticated
  using (shared.current_staff_role() is not null);

create trigger set_updated_at
  before update on hr.work_schedules
  for each row execute function shared.set_updated_at();

alter publication supabase_realtime add table hr.work_schedules;

-- ---------------------------------------------------------------------------
-- 201 documents
-- ---------------------------------------------------------------------------

create table hr.document_types (
  id text primary key,
  name text not null,
  category text not null check (category in ('identity', 'government', 'employment', 'clearance', 'record')),
  required boolean not null default true,
  -- Clearances and medical certificates go stale; the checklist page turns
  -- amber when issued_on + validity has passed.
  validity_months integer check (validity_months is null or validity_months > 0),
  notes text,
  sort integer not null,
  active boolean not null default true
);

-- The masterlist's "201 Checklist" sheet, plus the PRC ID column the
-- masterlist itself carries (the resident social worker must hold one:
-- RA 4373, and DSWD MC 17 s.2018 for a licensed residential facility).
insert into hr.document_types (id, name, category, required, validity_months, notes, sort) values
  ('resume', 'Resume / CV / Bio-data', 'employment', true, null, null, 1),
  ('diploma_tor', 'Diploma & TOR', 'identity', true, null, null, 2),
  ('valid_id', 'Valid ID', 'identity', true, null, null, 3),
  ('nbi_clearance', 'NBI Clearance', 'clearance', true, 12, null, 4),
  ('police_clearance', 'Police Clearance', 'clearance', true, 12, null, 5),
  ('birth_certificate', 'Birth Certificate', 'identity', true, null, null, 6),
  ('medical_certificate', 'Medical Examinations & Certificate', 'clearance', true, 12, null, 7),
  ('bir_1902_2305', 'BIR 1902 / 2305', 'government', true, null, null, 8),
  ('sss_no', 'SSS No.', 'government', true, null, null, 9),
  ('philhealth_no', 'PhilHealth No.', 'government', true, null, null, 10),
  ('pagibig_no', 'Pag-IBIG No.', 'government', true, null, null, 11),
  ('tin', 'TIN', 'government', true, null, null, 12),
  ('employment_contract', 'Employment Contract', 'employment', true, null, 'Probation standards must be given at engagement (Art. 296)', 13),
  ('nda', 'Non-Disclosure Agreement', 'employment', true, null, null, 14),
  ('performance_evaluations', 'Performance Evaluations', 'record', false, null, 'Every 3 months or before probationary employment ends', 15),
  ('disciplinary_records', 'Disciplinary Records', 'record', false, null, 'Formal warnings, demotion, or dismissal for misconduct & policy violations', 16),
  ('exit_clearance', 'Exit Clearance', 'record', false, null, 'If resigned', 17),
  ('prc_id', 'PRC ID', 'government', false, 36, 'Licensed positions only (RSW under RA 4373)', 18);

alter table hr.document_types enable row level security;

create policy "staff read document types" on hr.document_types
  for select to authenticated
  using (shared.current_staff_role() is not null);

create policy "hr manage document types" on hr.document_types
  for all to authenticated
  using (hr.is_hr_staff())
  with check (hr.is_hr_staff());

alter publication supabase_realtime add table hr.document_types;

create table hr.employee_documents (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references hr.employees (id) on delete cascade,
  document_type_id text not null references hr.document_types (id),
  status text not null default 'missing'
    check (status in ('complete', 'missing', 'expired', 'not_applicable', 'for_renewal', 'submitted', 'pending')),
  drive_url text,
  issued_on date,
  expires_on date,
  notes text,
  updated_by uuid references shared.staff (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, document_type_id)
);

alter table hr.employee_documents enable row level security;

create policy "hr manage employee documents" on hr.employee_documents
  for all to authenticated
  using (hr.is_hr_staff())
  with check (hr.is_hr_staff());

create policy "own employee documents" on hr.employee_documents
  for select to authenticated
  using (employee_id = hr.current_employee_id());

create trigger set_updated_at
  before update on hr.employee_documents
  for each row execute function shared.set_updated_at();

alter publication supabase_realtime add table hr.employee_documents;
