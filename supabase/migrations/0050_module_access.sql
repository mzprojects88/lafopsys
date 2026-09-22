-- 0050: who may open and who may change each module, set by an admin in
-- Settings -> Roles & Access instead of written into code. One row per
-- (role, module): none / view / edit. No row means none. Admin is edit
-- everywhere, always -- the table refuses anything else for admin, so nobody
-- can lock the foundation out of its own system.
--
-- Enforced here, not only on screen: every ops table that still carried the
-- blanket "lafopsys staff full access" policy (any of seven roles could read
-- and write anything) gets a read policy and write policies keyed to its
-- module. Reads of resident data are shared between Patients and House
-- Operations (the trip passenger list, meal exceptions and the in-house count
-- need names and stays), so a house staff member can do their job without the
-- Patients menu. Policies earlier migrations already narrowed are kept, with
-- their hardcoded role lists swapped for the module they belong to.
--
-- Deliberately NOT here:
--   * hr.* keeps its own rule (hr.is_hr_staff(): admins plus the HR flag on a
--     person). The HR row in the grid only shows or hides the menu.
--   * shared.staff (users, roles, PINs) and this table stay admin-only, whatever
--     the Settings row says: letting another role edit roles is letting it
--     make itself admin.
--   * the floor plan's drawing (geometry, create/retire bed, labels) stays
--     admin-only; the Patients level decides who may lock a bed.
--   * laf-inventory's own schema and grants.
--   * aggregate pages (Executive, Analytics, Dashboard) read only what the
--     viewer's other modules allow; their rows do not open raw data.
-- Seeded to match what the menu showed before, so nothing changes on apply
-- except: board, volunteer and read-only roles lose write access they never
-- had a screen for, and the patient-documents bucket stops accepting any
-- signed-in account (donor-portal logins included).
-- Rollback: supabase/rollbacks/0050_down.sql.

-- ---------------------------------------------------------------------
-- 1. The grid
-- ---------------------------------------------------------------------

create table shared.module_access (
  role text not null check (role in (
    'admin', 'social_worker', 'house_staff', 'driver', 'finance', 'board', 'volunteer',
    'inventory_staff', 'chef', 'nutritionist', 'inventory_lead')),
  module text not null check (module in (
    'executive', 'dashboard', 'calendar', 'staff', 'hr', 'patients', 'house_ops', 'donors',
    'inventory', 'finance', 'compliance', 'analytics', 'reports', 'settings')),
  level text not null check (level in ('none', 'view', 'edit')),
  updated_at timestamptz not null default now(),
  updated_by uuid references shared.staff (id),
  primary key (role, module)
);

create or replace function shared.guard_module_access()
returns trigger
language plpgsql
as $$
begin
  if new.role = 'admin' and new.level <> 'edit' then
    raise exception 'Admins always have full access' using errcode = '23514';
  end if;
  -- Settings holds users, roles and this grid: opening it to another role
  -- would let that role make itself admin.
  if new.module = 'settings' and new.role <> 'admin' and new.level <> 'none' then
    raise exception 'Settings stays with admins' using errcode = '23514';
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

create trigger guard_module_access
  before insert or update on shared.module_access
  for each row execute function shared.guard_module_access();

alter table shared.module_access enable row level security;
create policy "staff read module access" on shared.module_access
  for select to authenticated using ((select shared.current_staff_role()) is not null);
create policy "admins set module access" on shared.module_access
  for insert to authenticated with check ((select shared.current_staff_role()) = 'admin');
create policy "admins change module access" on shared.module_access
  for update to authenticated
  using ((select shared.current_staff_role()) = 'admin')
  with check ((select shared.current_staff_role()) = 'admin');
revoke all on shared.module_access from authenticated;
grant select, insert, update on shared.module_access to authenticated;

insert into shared.module_access (role, module, level)
select r, m, 'edit' from unnest(array['executive', 'dashboard', 'calendar', 'staff', 'hr', 'patients', 'house_ops',
  'donors', 'inventory', 'finance', 'compliance', 'analytics', 'reports', 'settings']) m, (values ('admin')) a(r)
union all
select r, m, l from (values
  -- what the menu showed before 0050; edit where that role could change things
  ('board', 'executive', 'view'),
  ('social_worker', 'dashboard', 'view'), ('house_staff', 'dashboard', 'view'), ('driver', 'dashboard', 'view'),
  ('finance', 'dashboard', 'view'), ('board', 'dashboard', 'view'), ('volunteer', 'dashboard', 'view'),
  ('social_worker', 'calendar', 'edit'),
  ('social_worker', 'patients', 'edit'),
  ('social_worker', 'house_ops', 'edit'), ('house_staff', 'house_ops', 'edit'), ('driver', 'house_ops', 'edit'),
  ('finance', 'donors', 'edit'),
  ('house_staff', 'inventory', 'view'), ('finance', 'inventory', 'view'),
  ('finance', 'finance', 'edit'), ('board', 'finance', 'view'),
  ('finance', 'compliance', 'edit'),
  ('social_worker', 'analytics', 'view'), ('house_staff', 'analytics', 'view'), ('driver', 'analytics', 'view'),
  ('finance', 'analytics', 'view'), ('board', 'analytics', 'view'), ('volunteer', 'analytics', 'view'),
  ('finance', 'reports', 'edit'), ('board', 'reports', 'view')
) v(r, m, l)
union all
-- every role reads the calendar, has its own clock and its own payslips
select r, m, 'view' from unnest(array['social_worker', 'house_staff', 'driver', 'finance', 'board', 'volunteer',
  'inventory_staff', 'chef', 'nutritionist', 'inventory_lead']) r, unnest(array['calendar', 'staff', 'hr']) m
  where not (r = 'social_worker' and m = 'calendar')
union all
select r, 'inventory', 'view' from unnest(array['inventory_staff', 'chef', 'nutritionist', 'inventory_lead']) r;

alter publication supabase_realtime add table shared.module_access;

-- ---------------------------------------------------------------------
-- 2. The questions every policy asks
-- ---------------------------------------------------------------------

create or replace function shared.module_level(p_module text)
returns text
language sql
stable
security definer
set search_path = shared, pg_temp
as $$
  select case
    when r is null then 'none'
    when r = 'admin' then 'edit'
    else coalesce((select level from shared.module_access where role = r and module = p_module), 'none')
  end
  from (select shared.current_staff_role() as r) s;
$$;

create or replace function shared.module_viewable(variadic p_modules text[])
returns boolean
language sql
stable
security definer
set search_path = shared, pg_temp
as $$
  select exists (select 1 from unnest(p_modules) m where shared.module_level(m) in ('view', 'edit'));
$$;

create or replace function shared.module_editable(p_module text)
returns boolean
language sql
stable
security definer
set search_path = shared, pg_temp
as $$
  select shared.module_level(p_module) = 'edit';
$$;

revoke execute on function shared.module_level(text) from public;
revoke execute on function shared.module_viewable(text[]) from public;
revoke execute on function shared.module_editable(text) from public;
grant execute on function shared.module_level(text) to authenticated, service_role;
grant execute on function shared.module_viewable(text[]) to authenticated, service_role;
grant execute on function shared.module_editable(text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. The blanket policy, replaced table by table
-- ---------------------------------------------------------------------
-- readers: modules whose viewers may read the table ('*' = any lafopsys
-- role, as before -- the reference lists every form's dropdowns need);
-- writer: the module whose editors may insert, update and delete. Grants
-- are untouched, so tables the browser may not write (units, rooms,
-- bed_positions) stay that way. Other policies on these tables (donor
-- portal, laf-inventory's donor and donation inserts) are untouched.

do $$
declare
  rec record;
  read_expr text;
  write_expr text;
begin
  for rec in select * from (values
    ('patients', '{patients,house_ops}', 'patients'),
    ('carers', '{patients,house_ops}', 'patients'),
    ('stays', '{patients,house_ops}', 'patients'),
    ('appointments', '{patients,house_ops}', 'patients'),
    ('referrals', '{patients}', 'patients'),
    ('referral_diagnoses', '{patients}', 'patients'),
    ('patient_diagnoses', '{patients,house_ops}', 'patients'),
    ('patient_documents', '{patients}', 'patients'),
    ('patient_orientation_checks', '{patients}', 'patients'),
    ('orientation_topics', '{patients}', 'patients'),
    ('units', '{patients,house_ops}', 'patients'),
    ('rooms', '{patients,house_ops}', 'patients'),
    ('bed_positions', '{patients,house_ops}', 'patients'),
    ('trips', '{house_ops}', 'house_ops'),
    ('trip_passengers', '{house_ops}', 'house_ops'),
    ('meal_services', '{house_ops}', 'house_ops'),
    ('meal_service_exceptions', '{house_ops}', 'house_ops'),
    ('care_cart_logs', '{house_ops}', 'house_ops'),
    ('activity_sessions', '{house_ops}', 'house_ops'),
    ('census_snapshots', '{house_ops,patients}', 'house_ops'),
    ('donors', '{donors,finance}', 'donors'),
    ('donations', '{donors,finance}', 'donors'),
    ('acknowledgment_receipts', '{donors,finance}', 'donors'),
    ('donee_certificates', '{donors,finance}', 'donors'),
    ('campaigns', '{donors,finance}', 'donors'),
    ('campaign_commitments', '{donors,finance}', 'donors'),
    ('donor_pledges', '{donors,finance}', 'donors'),
    ('metric_snapshots', '{donors,finance,reports}', 'donors'),
    ('accounts', '{finance,reports}', 'finance'),
    ('cash_entries', '{finance,reports}', 'finance'),
    ('budget_lines', '{finance,reports}', 'finance'),
    ('volunteers', '{staff}', 'staff'),
    ('provinces', '{*}', 'settings'),
    ('cities', '{*}', 'settings'),
    ('diagnoses', '{*}', 'settings'),
    ('treatment_phases', '{*}', 'settings'),
    ('hospitals', '{*}', 'settings'),
    ('hospital_nurses', '{*}', 'settings'),
    ('programs', '{*}', 'settings')
  ) v(tbl, readers, writer)
  loop
    if not exists (select 1 from pg_policies where schemaname = 'ops' and tablename = rec.tbl
                   and policyname = 'lafopsys staff full access') then
      raise exception 'ops.% has no blanket policy to replace', rec.tbl;
    end if;
    execute format('drop policy "lafopsys staff full access" on ops.%I', rec.tbl);

    read_expr := case when rec.readers = '{*}'
      then $e$(select shared.current_staff_role()) in ('admin','social_worker','house_staff','driver','finance','board','volunteer')$e$
      else format('(select shared.module_viewable(variadic %L::text[]))', rec.readers) end;
    write_expr := format('(select shared.module_editable(%L))', rec.writer);

    execute format('create policy "module read" on ops.%I for select to authenticated using (%s)', rec.tbl, read_expr);
    execute format('create policy "module insert" on ops.%I for insert to authenticated with check (%s)', rec.tbl, write_expr);
    execute format('create policy "module update" on ops.%I for update to authenticated using (%s) with check (%s)', rec.tbl, write_expr, write_expr);
    execute format('create policy "module delete" on ops.%I for delete to authenticated using (%s)', rec.tbl, write_expr);
  end loop;

  if exists (select 1 from pg_policies where policyname = 'lafopsys staff full access') then
    raise exception 'A table still carries the blanket policy: %',
      (select string_agg(schemaname || '.' || tablename, ', ') from pg_policies where policyname = 'lafopsys staff full access');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 4. Policies that named roles, now naming their module
-- ---------------------------------------------------------------------

-- Calendar: everyone still reads ("staff read calendar"); editors write.
drop policy "admin and social workers manage calendar" on ops.calendar_events;
create policy "calendar editors insert" on ops.calendar_events for insert to authenticated
  with check ((select shared.module_editable('calendar')));
create policy "calendar editors update" on ops.calendar_events for update to authenticated
  using ((select shared.module_editable('calendar'))) with check ((select shared.module_editable('calendar')));
create policy "calendar editors delete" on ops.calendar_events for delete to authenticated
  using ((select shared.module_editable('calendar')));

-- House sheet: part of Patients.
drop policy "patient staff read the house sheet" on ops.house_sheet_people;
drop policy "patient staff review the house sheet" on ops.house_sheet_people;
drop policy "patient staff read house sheet runs" on ops.house_sheet_sync_runs;
create policy "patients viewers read the house sheet" on ops.house_sheet_people for select to authenticated
  using ((select shared.module_viewable('patients')));
create policy "patients editors review the house sheet" on ops.house_sheet_people for update to authenticated
  using ((select shared.module_editable('patients'))) with check ((select shared.module_editable('patients')));
create policy "patients viewers read house sheet runs" on ops.house_sheet_sync_runs for select to authenticated
  using ((select shared.module_viewable('patients')));

-- Floor plan labels: read with the beds; the drawing stays admin-only.
drop policy "lafopsys staff read floor plan labels" on ops.floor_plan_labels;
create policy "bed viewers read floor plan labels" on ops.floor_plan_labels for select to authenticated
  using ((select shared.module_viewable('patients', 'house_ops')));

-- Bank statements and month notes: Financial.
drop policy "finance readers" on ops.bank_statement_imports;
drop policy "finance writers" on ops.bank_statement_imports;
create policy "finance viewers read imports" on ops.bank_statement_imports for select to authenticated
  using ((select shared.module_viewable('finance')));
create policy "finance editors import" on ops.bank_statement_imports for insert to authenticated
  with check ((select shared.module_editable('finance')));
drop policy "finance readers" on ops.bank_transactions;
drop policy "finance writers" on ops.bank_transactions;
drop policy "finance edit" on ops.bank_transactions;
create policy "finance viewers read transactions" on ops.bank_transactions for select to authenticated
  using ((select shared.module_viewable('finance')));
create policy "finance editors add transactions" on ops.bank_transactions for insert to authenticated
  with check ((select shared.module_editable('finance')));
create policy "finance editors change transactions" on ops.bank_transactions for update to authenticated
  using ((select shared.module_editable('finance'))) with check ((select shared.module_editable('finance')));
drop policy "finance write month notes" on ops.finance_month_notes;
create policy "finance editors insert month notes" on ops.finance_month_notes for insert to authenticated
  with check ((select shared.module_editable('finance')));
create policy "finance editors update month notes" on ops.finance_month_notes for update to authenticated
  using ((select shared.module_editable('finance'))) with check ((select shared.module_editable('finance')));
create policy "finance editors delete month notes" on ops.finance_month_notes for delete to authenticated
  using ((select shared.module_editable('finance')));

-- Compliance filings: HR people keep "hr manage compliance filings"; the
-- finance-role policies become the Compliances module.
drop policy "finance reads compliance filings" on hr.compliance_filings;
drop policy "finance records compliance filings" on hr.compliance_filings;
drop policy "finance updates compliance filings" on hr.compliance_filings;
create policy "compliance viewers read filings" on hr.compliance_filings for select to authenticated
  using ((select shared.module_viewable('compliance')));
create policy "compliance editors record filings" on hr.compliance_filings for insert to authenticated
  with check ((select shared.module_editable('compliance')));
create policy "compliance editors update filings" on hr.compliance_filings for update to authenticated
  using ((select shared.module_editable('compliance'))) with check ((select shared.module_editable('compliance')));

-- Patient document checklist uploads (0006): was any signed-in account.
drop policy "authenticated staff full access to patient documents" on storage.objects;
create policy "patients viewers read patient documents" on storage.objects for select to authenticated
  using (bucket_id = 'patient-documents' and (select shared.module_viewable('patients')));
create policy "patients editors add patient documents" on storage.objects for insert to authenticated
  with check (bucket_id = 'patient-documents' and (select shared.module_editable('patients')));
create policy "patients editors change patient documents" on storage.objects for update to authenticated
  using (bucket_id = 'patient-documents' and (select shared.module_editable('patients')))
  with check (bucket_id = 'patient-documents' and (select shared.module_editable('patients')));
create policy "patients editors remove patient documents" on storage.objects for delete to authenticated
  using (bucket_id = 'patient-documents' and (select shared.module_editable('patients')));

-- File library (0045): patients / donors / finance follow their modules;
-- hr and compliance keep the HR flag (plus Compliances editors).
create or replace function shared.file_read_allowed(m text, rt text, rid uuid)
returns boolean
language sql
stable
security invoker
set search_path = shared, hr, pg_temp
as $$
  select case m
    when 'hr' then hr.is_hr_staff() or (rt = 'employee' and rid is not null and rid = hr.current_employee_id())
    when 'compliance' then hr.is_hr_staff() or shared.module_viewable('compliance')
    when 'patients' then shared.module_viewable('patients')
    when 'donors' then shared.module_viewable('donors')
    else shared.module_viewable('finance')
  end;
$$;

create or replace function shared.file_write_allowed(m text)
returns boolean
language sql
stable
security invoker
set search_path = shared, hr, pg_temp
as $$
  select case m
    when 'hr' then hr.is_hr_staff()
    when 'compliance' then hr.is_hr_staff() or shared.module_editable('compliance')
    when 'patients' then shared.module_editable('patients')
    when 'donors' then shared.module_editable('donors')
    else shared.module_editable('finance')
  end;
$$;

-- ---------------------------------------------------------------------
-- 5. Functions and triggers that named roles
-- ---------------------------------------------------------------------

-- Beds: locking follows Patients edit; the drawing stays admin-only.
create or replace function ops.guard_unit_columns()
returns trigger
language plpgsql
as $$
declare
  r text := coalesce(shared.current_staff_role(), '');
  geometry_changed boolean :=
       new.code is distinct from old.code
    or new.room_id is distinct from old.room_id
    or new.x is distinct from old.x
    or new.y is distinct from old.y
    or new.w is distinct from old.w
    or new.h is distinct from old.h
    or new.rotation_deg is distinct from old.rotation_deg
    or new.capacity is distinct from old.capacity
    or new.active is distinct from old.active
    or new.retired_at is distinct from old.retired_at
    or new.shared_unit is distinct from old.shared_unit;
  lock_changed boolean :=
       new.status is distinct from old.status
    or new.lock_reason is distinct from old.lock_reason;
begin
  if old.active and not new.active and exists (
    select 1 from ops.stays s
    join ops.bed_positions bp on bp.id = s.bed_position_id
    where bp.unit_id = old.id and s.status in ('in_house', 'overdue')
  ) then
    raise exception 'Bed % still has a patient checked in -- transfer or discharge them first', old.code
      using errcode = '23514';
  end if;
  if new.status = 'available' then
    new.lock_reason := null;
  end if;

  if current_user <> 'authenticated' then
    return new;
  end if;

  if not shared.module_editable('patients') then
    raise exception 'This role cannot change beds' using errcode = '42501';
  end if;
  if new.id is distinct from old.id
     or new.status_changed_at is distinct from old.status_changed_at
     or new.status_changed_by is distinct from old.status_changed_by then
    raise exception 'Bed identity and the lock stamp are set by the database' using errcode = '42501';
  end if;
  if geometry_changed and r <> 'admin' then
    raise exception 'Only admins can change the floor plan' using errcode = '42501';
  end if;
  if lock_changed then
    new.status_changed_at := now();
    new.status_changed_by := auth.uid();
  end if;
  return new;
end;
$$;

-- Check-in (0049): Patients editors, not a fixed pair of roles. The body is
-- 0049's with that one line changed.
do $$
declare
  src text := pg_get_functiondef('ops.check_in(text,date,uuid,uuid,uuid,text,text,text,date,date,text,text,text,boolean)'::regprocedure);
  old_gate text := $g$if coalesce(shared.current_staff_role(), '') not in ('admin', 'social_worker') then
    raise exception 'Only admins and social workers check patients in' using errcode = '42501';$g$;
  new_gate text := $g$if not shared.module_editable('patients') then
    raise exception 'Your access to Patients is view only' using errcode = '42501';$g$;
begin
  if position(old_gate in src) = 0 then
    raise exception 'ops.check_in does not carry the role gate this migration replaces';
  end if;
  execute replace(src, old_gate, new_gate);
end $$;

notify pgrst, 'reload schema';
