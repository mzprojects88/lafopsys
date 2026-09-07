-- Reverses 0031: restores the guard function exactly as 0025 wrote it, then
-- drops the two columns. Whoever was exempt from clocking in is gated again
-- from their next page load, and everyone lands on /dashboard.

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
     )
     and coalesce(shared.current_staff_role(), '') <> 'admin' then
    raise exception 'Only admins can change staff role, status, or code'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

alter table shared.staff
  drop column clock_in_exempt,
  drop column landing_path;
