-- 0074: the Super Admin is only ever a MAIN role.
--
-- Phase 2 of the role segregation (2026-10-02). About 25 server checks and the
-- admin-only middleware read shared.staff.role, the main role. An "additional
-- admin" would therefore be an admin to the database (has_role, 0073) but not
-- to those checks -- half an admin. So 'admin' may not be an additional role;
-- the CEO is stored as main role 'admin' with 'ceo' additional, and is shown
-- as CEO. Settings > Users refuses it too; this is the rule underneath.
-- Nobody holds additional roles yet, so no row is affected.

alter table shared.staff add constraint staff_admin_main_only check (not ('admin' = any (extra_roles)));
