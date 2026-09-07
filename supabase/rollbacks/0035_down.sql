-- Reverses 0035: restores the guard function exactly as 0031 wrote it, drops
-- the is_hr flag, and removes the hr schema. Must run AFTER 0036+'s
-- rollbacks -- `drop schema hr` refuses while their tables exist, which is
-- deliberate: nobody loses payroll history by rolling back the flag.
-- btree_gist is left installed (harmless, and other schemas may use it).

alter role authenticator set pgrst.db_schemas = 'public, ops, inventory, shared';
notify pgrst, 'reload config';

drop function if exists hr.is_hr_staff();
drop schema hr;

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
     )
     and coalesce(shared.current_staff_role(), '') <> 'admin' then
    raise exception 'Only admins can change staff role, status, code, or access settings'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

alter table shared.staff drop column is_hr;
