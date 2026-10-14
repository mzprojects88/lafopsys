-- 0093: roles you create, access per page, and powers on the role (decided by the user 2026-10-14).
--
--   1. shared.roles: every role, built-in (today's 14) or created by an admin. The fixed role
--      lists in the CHECK constraints become references to it.
--   2. shared.role_page_access(role, page, level): a level per page ('<menu>.<page>', the
--      catalogue is lib/rbac/pages.ts). A trigger keeps shared.module_access = the highest page
--      level of each menu, so module_level() and every database rule built on it stay as they are:
--      the database protects each menu, the app shows and hides each page.
--   3. shared.role_powers(role, power) + shared.has_power(): what used to belong to fixed role
--      names -- runs HR, finance work, allowing a bed-rule exception, editing the floor-plan
--      layout, being a driver, seeing clinical detail. The Super Admin holds every power.
--      hr.is_hr_staff, ops.can_allow_bed_exception, the floor-plan functions and policies, and the
--      finance policies read powers now.
--
-- Day one changes nothing: page rows copy today's grid, powers copy today's role lists. One
-- widening, on purpose: "Finance work" is the app's doesFinance (Super Admin, Finance, Office
-- Admin), so the Office Admin now also reads everyone's punches and the donor portal accounts at
-- the database, as the app already showed them.
-- Rollback: supabase/rollbacks/0093_down.sql

-- ---------------------------------------------------------------------
-- 1. Roles
-- ---------------------------------------------------------------------
create table shared.roles (
  key text primary key check (key ~ '^[a-z][a-z0-9_-]{1,40}$'),
  name text not null check (length(btrim(name)) between 2 and 60),
  description text,
  built_in boolean not null default false,
  created_by uuid references shared.staff(id),
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
create unique index roles_name_live on shared.roles (lower(btrim(name))) where archived_at is null;
comment on table shared.roles is 'Every role: built-in (0093 seed) or created by an admin. Access per page in role_page_access, powers in role_powers.';

insert into shared.roles (key, name, built_in) values
  ('admin', 'Super Admin', true),
  ('ceo', 'CEO', true),
  ('office_admin', 'Office Admin', true),
  ('social_worker', 'Social Worker', true),
  ('house_staff', 'House Staff', true),
  ('driver', 'Driver', true),
  ('finance', 'Finance Staff', true),
  ('board', 'Board', true),
  ('volunteer', 'Volunteer', true),
  ('chef', 'Chef & Kitchen Staff', true),
  ('inventory_staff', 'Inventory Staff', true),
  ('inventory_lead', 'Inventory Lead', true),
  ('nutritionist', 'Nutritionist', true),
  ('partner_viewer', 'Partner viewer (outside)', true);

alter table shared.staff drop constraint staff_role_check;
alter table shared.staff add constraint staff_role_fkey foreign key (role) references shared.roles(key);
alter table shared.staff drop constraint staff_extra_roles_check;
alter table shared.staff add constraint staff_extra_roles_shape check (not (role = any (extra_roles)) and cardinality(extra_roles) <= 3);
alter table shared.module_access drop constraint module_access_role_check;
alter table shared.module_access add constraint module_access_role_fkey foreign key (role) references shared.roles(key) on delete cascade;

-- Additional roles (an array, so no foreign key): live roles only, never an outside one.
create or replace function shared.guard_staff_roles()
returns trigger
language plpgsql
as $$
begin
  if (tg_op = 'INSERT' or new.role is distinct from old.role)
     and exists (select 1 from shared.roles r where r.key = new.role and r.archived_at is not null) then
    raise exception 'That role is archived' using errcode = '23514';
  end if;
  if exists (select 1 from unnest(new.extra_roles) x
              where x = 'partner_viewer' or not exists (select 1 from shared.roles r where r.key = x and r.archived_at is null)) then
    raise exception 'An additional role must be a live staff role' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger guard_staff_roles before insert or update of role, extra_roles on shared.staff
  for each row execute function shared.guard_staff_roles();

create or replace function shared.guard_role()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    if new.key is distinct from old.key or new.built_in is distinct from old.built_in then
      raise exception 'A role''s key stays as it was' using errcode = '23514';
    end if;
    if old.built_in and new.archived_at is not null then
      raise exception 'A built-in role cannot be archived' using errcode = '23514';
    end if;
    if new.archived_at is not null and old.archived_at is null
       and exists (select 1 from shared.staff s where s.role = new.key or new.key = any (s.extra_roles)) then
      raise exception 'People still hold this role: give them another first' using errcode = '23514';
    end if;
  elsif new.built_in then
    raise exception 'Built-in roles come with the system' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger guard_role before insert or update on shared.roles for each row execute function shared.guard_role();

alter table shared.roles enable row level security;
create policy "staff read roles" on shared.roles for select to authenticated using ((select shared.current_staff_role()) is not null);
create policy "admins add roles" on shared.roles for insert to authenticated with check (shared.has_role('admin'));
create policy "admins change roles" on shared.roles for update to authenticated using (shared.has_role('admin')) with check (shared.has_role('admin'));
revoke all on shared.roles from authenticated;
grant select, insert, update on shared.roles to authenticated;

-- ---------------------------------------------------------------------
-- 2. A level per page
-- ---------------------------------------------------------------------
create table shared.role_page_access (
  role text not null references shared.roles(key) on delete cascade,
  page text not null check (page ~ '^(executive|dashboard|calendar|staff|hr|patients|house_ops|donors|inventory|finance|compliance|analytics|reports|transport)\.[a-z_]+$'),
  level text not null check (level in ('view', 'edit')),
  updated_at timestamptz not null default now(),
  updated_by uuid references shared.staff(id),
  primary key (role, page)
);
comment on table shared.role_page_access is 'A role''s level on one page (no row = None). The menu level in module_access follows the highest page (0093).';

create or replace function shared.guard_role_page_access()
returns trigger
language plpgsql
as $$
begin
  if new.role in ('admin', 'partner_viewer') then
    raise exception 'The Super Admin has every page, and an outside account''s areas are set apart' using errcode = '23514';
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;
create trigger guard_role_page_access before insert or update on shared.role_page_access
  for each row execute function shared.guard_role_page_access();

-- The menu level the database enforces = the highest of the menu's pages.
create or replace function shared.sync_module_from_pages()
returns trigger
language plpgsql
security definer
set search_path = shared, pg_temp
as $$
declare
  v_role text := coalesce(new.role, old.role);
  v_module text := split_part(coalesce(new.page, old.page), '.', 1);
  v_level text;
begin
  if not exists (select 1 from shared.roles where key = v_role) then
    return null; -- the role itself is being removed
  end if;
  select case max(case level when 'edit' then 2 else 1 end) when 2 then 'edit' when 1 then 'view' else 'none' end
    into v_level
    from shared.role_page_access
   where role = v_role and split_part(page, '.', 1) = v_module;
  insert into shared.module_access (role, module, level) values (v_role, v_module, coalesce(v_level, 'none'))
    on conflict (role, module) do update set level = excluded.level;
  return null;
end;
$$;
create trigger sync_module_from_pages after insert or update or delete on shared.role_page_access
  for each row execute function shared.sync_module_from_pages();
-- A trigger function: nobody calls it directly.
revoke all on function shared.sync_module_from_pages() from public;

alter table shared.role_page_access enable row level security;
create policy "staff read page access" on shared.role_page_access for select to authenticated using ((select shared.current_staff_role()) is not null);
create policy "admins set page access" on shared.role_page_access for all to authenticated using (shared.has_role('admin')) with check (shared.has_role('admin'));
revoke all on shared.role_page_access from authenticated;
grant select, insert, update, delete on shared.role_page_access to authenticated;

-- Today's grid, page by page (the catalogue in lib/rbac/pages.ts; HR management follows a power).
insert into shared.role_page_access (role, page, level)
select a.role, p.page, a.level
  from shared.module_access a
  join (values
    ('dashboard.home'), ('calendar.calendar'), ('calendar.sync_log'),
    ('patients.all'), ('patients.house_sheet'), ('patients.today'), ('patients.floor_plan'), ('patients.appointments'), ('patients.manifest'),
    ('patients.rides'), ('patients.stays'), ('patients.bed_nights'), ('patients.waitlist'), ('patients.referrals'), ('patients.admit'),
    ('transport.trips'), ('transport.fuel'), ('transport.report'),
    ('staff.home'), ('staff.dtr'), ('staff.roster'), ('staff.timesheets'), ('staff.volunteers'),
    ('inventory.overview'), ('inventory.assets'), ('inventory.locations'), ('inventory.expiry'), ('inventory.waste'), ('inventory.scan'),
    ('hr.my_leave'), ('hr.my_payslips'),
    ('compliance.tracker'),
    ('house_ops.overview'), ('house_ops.meals'), ('house_ops.care_cart'), ('house_ops.activity_center'),
    ('donors.list'), ('donors.receipts'), ('donors.donee_certs'), ('donors.campaigns'), ('donors.cleanup'), ('donors.cash'), ('donors.intake'),
    ('finance.overview'), ('finance.monthly_summary'), ('finance.bank_import'), ('finance.accounts'), ('finance.approvals'), ('finance.allocation'),
    ('finance.cost_per_outcome'), ('finance.budget'), ('finance.close'), ('finance.registers'), ('finance.vehicle_costs'), ('finance.entry'),
    ('analytics.dashboard'),
    ('reports.catalogue'), ('reports.documents'), ('reports.builder'), ('reports.schedule'),
    ('executive.overview')
  ) as p(page) on split_part(p.page, '.', 1) = a.module
 where a.role not in ('admin', 'partner_viewer') and a.level in ('view', 'edit');

-- ---------------------------------------------------------------------
-- 3. Powers
-- ---------------------------------------------------------------------
create table shared.role_powers (
  role text not null references shared.roles(key) on delete cascade,
  power text not null check (power in ('runs_hr', 'finance_work', 'bed_exception', 'floor_plan_layout', 'driver', 'clinical_detail')),
  primary key (role, power)
);
comment on table shared.role_powers is 'What a role may do beyond its pages (0093). The Super Admin holds every power without a row.';
create or replace function shared.guard_role_powers()
returns trigger
language plpgsql
as $$
begin
  if new.role in ('admin', 'partner_viewer') then
    raise exception 'The Super Admin holds every power, and an outside account none' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger guard_role_powers before insert or update on shared.role_powers for each row execute function shared.guard_role_powers();
alter table shared.role_powers enable row level security;
create policy "staff read powers" on shared.role_powers for select to authenticated using ((select shared.current_staff_role()) is not null);
create policy "admins set powers" on shared.role_powers for all to authenticated using (shared.has_role('admin')) with check (shared.has_role('admin'));
revoke all on shared.role_powers from authenticated;
grant select, insert, delete on shared.role_powers to authenticated;

-- Today's role lists, as powers.
insert into shared.role_powers (role, power) values
  ('office_admin', 'runs_hr'),
  ('finance', 'finance_work'), ('office_admin', 'finance_work'),
  ('social_worker', 'bed_exception'), ('inventory_lead', 'bed_exception'),
  ('driver', 'driver'),
  ('ceo', 'clinical_detail'), ('office_admin', 'clinical_detail'), ('social_worker', 'clinical_detail'), ('house_staff', 'clinical_detail'),
  ('driver', 'clinical_detail'), ('volunteer', 'clinical_detail'), ('chef', 'clinical_detail'), ('inventory_staff', 'clinical_detail'),
  ('inventory_lead', 'clinical_detail'), ('nutritionist', 'clinical_detail');

create or replace function shared.has_power(p_power text)
returns boolean
language sql
stable
security definer
set search_path = shared, pg_temp
as $$
  select coalesce('admin' = any (shared.current_staff_roles()), false)
      or exists (select 1 from shared.role_powers rp where rp.power = p_power and rp.role = any (shared.current_staff_roles()));
$$;
revoke all on function shared.has_power(text) from public;
grant execute on function shared.has_power(text) to authenticated, service_role;

alter publication supabase_realtime add table shared.roles;
alter publication supabase_realtime add table shared.role_page_access;
alter publication supabase_realtime add table shared.role_powers;

-- ---------------------------------------------------------------------
-- 4. The checks that named roles now read powers
-- ---------------------------------------------------------------------
create or replace function hr.is_hr_staff()
returns boolean
language sql
stable
security definer
set search_path = shared, pg_temp
as $$
  -- A role with "Runs HR" (the Super Admin always), or a person with the HR switch (0035).
  select shared.has_power('runs_hr')
      or exists (select 1 from shared.staff where id = auth.uid() and active and is_hr and role <> 'partner_viewer');
$$;

create or replace function ops.can_allow_bed_exception()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select shared.has_power('bed_exception');
$$;

drop policy "admin and finance read all punches" on ops.time_punches;
create policy "finance work reads all punches" on ops.time_punches for select to authenticated using (shared.has_power('finance_work'));
drop policy "lafopsys staff manage donor accounts" on shared.donor_accounts;
create policy "finance work manages donor accounts" on shared.donor_accounts for all to authenticated
  using (shared.has_power('finance_work')) with check (shared.has_power('finance_work'));

drop policy "admin adds floor plan labels" on ops.floor_plan_labels;
drop policy "admin edits floor plan labels" on ops.floor_plan_labels;
drop policy "admin deletes floor plan labels" on ops.floor_plan_labels;
create policy "layout editors add floor plan labels" on ops.floor_plan_labels for insert to authenticated with check (shared.has_power('floor_plan_layout'));
create policy "layout editors edit floor plan labels" on ops.floor_plan_labels for update to authenticated using (shared.has_power('floor_plan_layout')) with check (shared.has_power('floor_plan_layout'));
create policy "layout editors delete floor plan labels" on ops.floor_plan_labels for delete to authenticated using (shared.has_power('floor_plan_layout'));

create or replace function ops.guard_room_columns()
returns trigger
language plpgsql
as $$
begin
  if current_user = 'authenticated' and not shared.has_power('floor_plan_layout') then
    raise exception 'Only staff who edit the floor-plan layout can change rooms' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function ops.guard_unit_columns()
returns trigger
language plpgsql
as $$
declare
  is_layout_editor boolean := shared.has_power('floor_plan_layout');
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
  if geometry_changed and not is_layout_editor then
    raise exception 'Only staff who edit the floor-plan layout can change it' using errcode = '42501';
  end if;
  if lock_changed then
    new.status_changed_at := now();
    new.status_changed_by := auth.uid();
  end if;
  return new;
end;
$$;

create or replace function ops.create_bed(p_code text, p_room_id text, p_x numeric, p_y numeric, p_rotation_deg integer default 0)
returns text
language plpgsql
security definer
set search_path = ops, shared, pg_temp
as $$
declare
  v_id text;
  v_existing ops.units%rowtype;
begin
  if not shared.has_power('floor_plan_layout') then
    raise exception 'Only staff who edit the floor-plan layout can add beds' using errcode = '42501';
  end if;
  if p_code !~ '^B[0-9]{1,3}$' then
    raise exception 'A bed code looks like B14' using errcode = '23514';
  end if;
  if p_room_id is not null and not exists (select 1 from ops.rooms where id = p_room_id) then
    raise exception 'Unknown room %', p_room_id using errcode = '23503';
  end if;

  select * into v_existing from ops.units where code = p_code;
  if found then
    if v_existing.active then
      raise exception 'Bed % already exists', p_code using errcode = '23505';
    end if;
    update ops.units
      set active = true, retired_at = null, room_id = p_room_id, x = p_x, y = p_y,
          rotation_deg = coalesce(p_rotation_deg, 0), status = 'available', lock_reason = null
      where id = v_existing.id;
    return v_existing.id;
  end if;

  v_id := 'unit-' || p_code;
  insert into ops.units (id, code, room_id, status, shared_unit, x, y, rotation_deg, capacity, active)
    values (v_id, p_code, p_room_id, 'available', false, p_x, p_y, coalesce(p_rotation_deg, 0), 1, true);
  insert into ops.bed_positions (id, unit_id, label)
    select v_id || '-' || l, v_id, l from unnest(array['A', 'B', 'C', 'D']) as l;
  return v_id;
end;
$$;

create or replace function ops.retire_bed(p_unit_id text)
returns void
language plpgsql
security definer
set search_path = ops, shared, pg_temp
as $$
begin
  if not shared.has_power('floor_plan_layout') then
    raise exception 'Only staff who edit the floor-plan layout can retire beds' using errcode = '42501';
  end if;
  if exists (
    select 1 from ops.stays s
    join ops.bed_positions bp on bp.id = s.bed_position_id
    where bp.unit_id = p_unit_id and s.status in ('in_house', 'overdue')
  ) then
    raise exception 'This bed still has a patient checked in -- transfer or discharge them first'
      using errcode = '23514';
  end if;
  update ops.units set active = false, retired_at = now(), status = 'available', lock_reason = null
    where id = p_unit_id and active;
  if not found then
    raise exception 'No active bed %', p_unit_id using errcode = 'P0002';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Creating a role
-- ---------------------------------------------------------------------
create or replace function shared.create_role(p_name text, p_description text, p_copy_from text)
returns text
language plpgsql
security definer
set search_path = shared, pg_temp
as $$
declare
  v_base text := trim(both '-' from regexp_replace(lower(btrim(p_name)), '[^a-z0-9]+', '-', 'g'));
  v_key text;
  v_n int := 1;
begin
  if not shared.has_role('admin') then
    raise exception 'Only the Super Admin creates roles' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_name, ''))) < 2 then
    raise exception 'Give the role a name' using errcode = '22023';
  end if;
  if p_copy_from in ('admin', 'partner_viewer') then
    raise exception 'Copy from a staff role, not the Super Admin or an outside account' using errcode = '22023';
  end if;
  v_key := 'role-' || left(coalesce(nullif(v_base, ''), 'custom'), 30);
  while exists (select 1 from shared.roles where key = v_key || case when v_n = 1 then '' else '-' || v_n end) loop
    v_n := v_n + 1;
  end loop;
  v_key := v_key || case when v_n = 1 then '' else '-' || v_n end;
  insert into shared.roles (key, name, description, built_in, created_by) values (v_key, btrim(p_name), nullif(btrim(p_description), ''), false, auth.uid());
  if p_copy_from is not null then
    insert into shared.role_page_access (role, page, level) select v_key, page, level from shared.role_page_access where role = p_copy_from;
    insert into shared.role_powers (role, power) select v_key, power from shared.role_powers where role = p_copy_from;
  end if;
  return v_key;
end;
$$;
revoke all on function shared.create_role(text, text, text) from public;
grant execute on function shared.create_role(text, text, text) to authenticated;
