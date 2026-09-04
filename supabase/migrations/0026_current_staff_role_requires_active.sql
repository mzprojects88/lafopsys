-- shared.current_staff_role() is the predicate every RLS policy in both apps
-- keys on, and it returned a role for a deactivated staff member for as long
-- as their session token lived -- so "deactivate" only took effect at token
-- expiry. Both apps' login rosters already hide inactive people and
-- laf-inventory's (app) layout refuses an inactive session, but the database
-- itself still said yes. Now it says null, and every policy denies on the
-- next request.
--
-- Test accounts (scripts/rls in laf-inventory) are deliberately inactive;
-- the harness flips `active` inside its rolled-back transaction per case.

create or replace function shared.current_staff_role()
returns text
language sql
security definer
set search_path = shared, pg_temp
stable
as $$
  select role from shared.staff where id = auth.uid() and active;
$$;
