-- Closes wiring-up-progress.md open decision #16.
--
-- 0001's "staff can update own row" policy (using/with check id = auth.uid())
-- never restricted WHICH columns a staff member may change, and `authenticated`
-- holds table-wide UPDATE on shared.staff (0001's grant, re-asserted by 0003's
-- default privileges). Net effect, confirmed live: any signed-in staff account
-- can PATCH its own `role` to 'admin' through PostgREST, and because
-- shared.current_staff_role() reads that column, both lafopsys and
-- laf-inventory honour the promotion everywhere.
--
-- The only browser-side writes to shared.staff are notification_prefs
-- (lib/hooks/use-notification-prefs.ts) and must_change_pin (both apps'
-- change-PIN pages), so the grant below is scoped to the profile-ish columns a
-- person may legitimately edit about themselves. role/active/staff_code are
-- written only through the service-role client (app/(app)/settings/users/
-- actions.ts, provisioning scripts), which grants on `authenticated` never
-- affect.
--
-- The trigger is the second line of defence. 0003's default privileges still
-- stand, so a future `grant ... on all tables in schema shared` would silently
-- re-open table-wide UPDATE; the trigger keeps the privileged columns
-- admin-only regardless of grants. Deliberately security INVOKER: it must see
-- the PostgREST role in current_user ('authenticated'), and it must let
-- service_role / postgres through untouched.

revoke update on shared.staff from authenticated;
grant update (first_name, last_name, photo_url, must_change_pin, notification_prefs)
  on shared.staff to authenticated;

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

create trigger guard_privileged_columns
  before update on shared.staff
  for each row execute function shared.guard_staff_privileged_columns();
