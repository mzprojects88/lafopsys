-- 0057: the patient master follows LAF's Patients Database sheet, and every
-- child gets a case number that only the app hands out (Master Plan, steps 1
-- and 2).
--
-- The sheet stays the source of truth while staff learn the app: the app
-- reads it every 30 minutes (/api/patients/master-sheet-sync) and the sheet
-- wins on the columns it has. Nothing here ever writes to the sheet.
--
--   * patients.case_number: LFCN-<year of first admission>-<4-digit running
--     number>, e.g. LFCN-2026-0187. Issued by ops.next_case_number under a
--     lock, never changed, never reused. A new patient gets one on insert
--     (trigger); the 186 already in the sheet get theirs from the sync, which
--     follows their CODE where there is one (LAF-2024-001-C -> LFCN-2024-0001).
--   * patients.patient_number is now the sheet's CN, and may be empty: a
--     child first admitted in the app has an LFCN at once and gets a CN when
--     their row appears in the sheet. check_in stops inventing CNs ("max+1"
--     would have handed out #170, which the sheet had already given to
--     another child).
--   * fields the sheet has and the app did not: type of illness (C, T, B, H,
--     O, FD), priority (A-D), the old CODE, distance from home, and the intake
--     form's consent, NCH social worker, physician, family profile and links.
--   * ops.master_sheet_sync_runs: one row per sync, what it did.
-- Rollback: supabase/rollbacks/0057_down.sql.

-- ---------------------------------------------------------------------
-- 1. Identity and the new fields
-- ---------------------------------------------------------------------

alter table ops.patients alter column patient_number drop not null;

alter table ops.patients
  add column case_number text unique
    constraint patients_case_number_format check (case_number ~ '^LFCN-[0-9]{4}-[0-9]{4}$'),
  add column legacy_code text,
  add column illness_code text
    constraint patients_illness_code check (illness_code in ('C', 'T', 'B', 'H', 'O', 'FD')),
  add column priority text
    constraint patients_priority check (priority in ('A', 'B', 'C', 'D')),
  add column distance_km numeric(7, 1)
    constraint patients_distance_km check (distance_km >= 0),
  add column consent_authorized_at timestamptz,
  add column mss_name text,
  add column attending_physician text,
  add column parent_education text,
  add column parent_occupation text,
  add column household_income text,
  add column parent_employment text,
  add column housing_type text,
  add column intake_links jsonb,
  add column sheet_synced_at timestamptz;

comment on column ops.patients.patient_number is 'The Patients Database sheet''s CN; empty until the sheet has the child';
comment on column ops.patients.case_number is 'LFCN-<year>-<nnnn>, issued only by the app (ops.next_case_number)';
comment on column ops.patients.illness_code is 'C Cancer (Hema-Onco), T Thalassemia, B Other Blood Disorders, H Heart / Cardiovascular, O Other Critical Illnesses, FD For determining';
comment on column ops.patients.priority is 'A Chemo, B Blood transfusion, C Post procedure, D Follow-up consultation';

-- The next number for a year: one past the highest issued that year.
create or replace function ops.next_case_number(p_year integer)
returns text
language plpgsql
security definer
set search_path = ops, pg_temp
as $$
declare
  v_next integer;
begin
  if p_year is null or p_year < 2000 or p_year > 2999 then
    raise exception 'A case number needs the year of first admission' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('ops.patients.case_number'));
  select coalesce(max(substr(case_number, 11)::integer), 0) + 1 into v_next
    from ops.patients where case_number like 'LFCN-' || p_year || '-%';
  if v_next > 9999 then
    raise exception 'Case numbers for % are used up', p_year using errcode = '22023';
  end if;
  return 'LFCN-' || p_year || '-' || lpad(v_next::text, 4, '0');
end;
$$;
revoke execute on function ops.next_case_number(integer) from public;
grant execute on function ops.next_case_number(integer) to service_role;

-- Every new patient leaves the insert with a case number.
create or replace function ops.fill_case_number()
returns trigger
language plpgsql
security definer
set search_path = ops, pg_temp
as $$
begin
  if new.case_number is null then
    new.case_number := ops.next_case_number(
      extract(year from coalesce(new.admitted_at, (now() at time zone 'Asia/Manila')::date))::integer);
  end if;
  return new;
end;
$$;
create trigger fill_case_number
  before insert on ops.patients
  for each row execute function ops.fill_case_number();

-- A case number never changes once issued.
create or replace function ops.guard_case_number()
returns trigger
language plpgsql
as $$
begin
  if old.case_number is not null and new.case_number is distinct from old.case_number then
    raise exception 'A case number never changes' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger guard_case_number
  before update of case_number on ops.patients
  for each row execute function ops.guard_case_number();

-- ---------------------------------------------------------------------
-- 2. check_in stops inventing CNs (0051's body, two lines changed)
-- ---------------------------------------------------------------------

do $$
declare
  src text := pg_get_functiondef('ops.check_in(text,date,uuid,uuid,uuid,text,text,text,date,date,text,text,text,boolean)'::regprocedure);
  old_number text := $o$    perform pg_advisory_xact_lock(hashtext('ops.patients.patient_number'));
    select (coalesce(max(patient_number::int), 0) + 1)::text into v_number
      from ops.patients where patient_number ~ '^[0-9]+$';$o$;
  new_number text := $n$    -- The CN is the sheet's to give; the LFCN comes from fill_case_number (0057).
    v_number := null;$n$;
  old_return text := $o$'patient_number', v_patient.patient_number);$o$;
  new_return text := $n$'patient_number', v_patient.patient_number, 'case_number', v_patient.case_number);$n$;
begin
  if position(old_number in src) = 0 or position(old_return in src) = 0 then
    raise exception 'ops.check_in does not carry the numbering this migration replaces';
  end if;
  execute replace(replace(src, old_number, new_number), old_return, new_return);
end $$;

-- ---------------------------------------------------------------------
-- 3. The sync's log, its switch, and its schedule
-- ---------------------------------------------------------------------

create table ops.master_sheet_sync_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'success', 'unchanged', 'failed')),
  trigger text not null check (trigger in ('cron', 'manual')),
  triggered_by uuid references shared.staff (id),
  csv_hash text,
  rows_seen integer not null default 0,
  inserted integer not null default 0,
  updated integer not null default 0,
  unchanged integer not null default 0,
  skipped integer not null default 0,
  reference_added integer not null default 0,
  numbers_assigned integer not null default 0,
  details jsonb,
  error text
);
create index master_sheet_sync_runs_started_idx on ops.master_sheet_sync_runs (started_at desc);

alter table ops.master_sheet_sync_runs enable row level security;
create policy "patients viewers read sync runs" on ops.master_sheet_sync_runs for select to authenticated
  using ((select shared.module_viewable('patients')));
-- Only the route, with the service role, writes runs.
revoke all on ops.master_sheet_sync_runs from authenticated;
grant select on ops.master_sheet_sync_runs to authenticated;
alter publication supabase_realtime add table ops.master_sheet_sync_runs;

alter table shared.app_settings
  add column master_sheet_sync_enabled boolean not null default true;

-- Every half hour, a quarter past and a quarter to (the house sheet runs on
-- the hour and the half). Same bearer secret as the other sheet syncs.
select cron.schedule(
  'master-sheet-sync',
  '15,45 * * * *',
  $$
  select net.http_post(
    url := 'https://lafopsys.vercel.app/api/patients/master-sheet-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'calendar_sync_secret' limit 1
      )
    ),
    body := '{"trigger":"cron"}'::jsonb,
    timeout_milliseconds := 240000
  );
  $$
);

notify pgrst, 'reload schema';
