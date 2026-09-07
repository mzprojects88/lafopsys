-- The HR module's foundation: a schema of its own, and the flag that says who
-- may run it.
--
-- Why a separate schema. Salaries, government ID numbers and bank details are
-- the most sensitive rows this system will hold (Data Privacy Act, RA 10173,
-- treats them as personal and sensitive personal information). ops.* still
-- carries 0015's blanket "lafopsys staff full access" policies, written when
-- every table was demo data; anything created there inherits nothing, but the
-- habit of `for all to authenticated` policies does. A fresh schema starts
-- with zero policies, so every hr table is closed until a policy opens it.
--
-- Plumbing follows 0003 exactly: PostgREST only serves schemas named in the
-- authenticator role's pgrst.db_schemas, and `authenticated` needs table-level
-- grants (RLS still gates the rows). The default privileges make every later
-- `create table hr.*` reachable without a grant of its own, the same way ops
-- and shared work. btree_gist is for the effective-dated tables in 0036,
-- whose "no overlapping compensation for one person" rule is a gist exclusion
-- over (employee_id, daterange).

create schema hr;

create extension if not exists btree_gist with schema extensions;

grant usage on schema hr to authenticated, service_role;

alter default privileges in schema hr grant select, insert, update, delete on tables to authenticated, service_role;
alter default privileges in schema hr grant usage on sequences to authenticated, service_role;
alter default privileges in schema hr grant execute on functions to authenticated, service_role;

alter role authenticator set pgrst.db_schemas = 'public, ops, inventory, shared, hr';
notify pgrst, 'reload config';

-- Who runs HR. Admins always can; the flag lets a non-admin (the
-- Administrative & Finance Specialist, say) do HR without being made an
-- admin of everything else. Per-person and PRIVILEGED, like 0031's two
-- columns: outside 0025's column grant, and inside the guard trigger so that
-- even a widened grant could not let someone flag themselves.

alter table shared.staff
  add column is_hr boolean not null default false;

create or replace function shared.guard_staff_privileged_columns()
returns trigger
language plpgsql
as $$
begin
  if current_user = 'authenticated'
     and (
       new.id is distinct from old.id
       or new.role is distinct from old.role
       or new.active is distinct from old.active
       or new.staff_code is distinct from old.staff_code
       or new.position is distinct from old.position
       or new.hire_date is distinct from old.hire_date
       or new.clock_in_exempt is distinct from old.clock_in_exempt
       or new.landing_path is distinct from old.landing_path
       or new.is_hr is distinct from old.is_hr
     )
     and coalesce(shared.current_staff_role(), '') <> 'admin' then
    raise exception 'Only admins can change staff role, status, code, or access settings'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- The predicate every hr.* policy keys on. Definer, like
-- shared.current_staff_role() (0026), and with the same "active only" rule:
-- a deactivated HR person loses HR on their next request, not at token
-- expiry.
create or replace function hr.is_hr_staff()
returns boolean
language sql
security definer
set search_path = shared, pg_temp
stable
as $$
  select exists (
    select 1
    from shared.staff
    where id = auth.uid()
      and active
      and (role = 'admin' or is_hr)
  );
$$;

grant execute on function hr.is_hr_staff() to authenticated, service_role;
