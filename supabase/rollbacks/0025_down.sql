-- Reverses 0025_staff_privileged_columns_guard.sql. Kept OUTSIDE supabase/
-- migrations/ so the CLI never picks it up as a forward migration.
--
-- WARNING: running this restores the self-promotion hole described in 0025's
-- header. Only use it to unblock a broken deploy, then re-apply 0025.

drop trigger if exists guard_privileged_columns on shared.staff;
drop function if exists shared.guard_staff_privileged_columns();

revoke update on shared.staff from authenticated;
grant update on shared.staff to authenticated;
