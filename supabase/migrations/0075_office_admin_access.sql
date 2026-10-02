-- 0075: what the Office Admin role opens (Roles & access rows).
--
-- Phase 3 of the role segregation (2026-10-02). Chosen with the user: Patients
-- & admissions, Calendar & Staff/Time, HR & Compliances, Donors & Finance.
-- Running HR itself comes with the role (hr.is_hr_staff, 0073); the HR menu is
-- view-only in the grid. Dashboard view so their home has figures on it.
-- Everything else stays None (House Ops, Transport, Reports, Analytics,
-- Executive, Inventory -- the Office Admin's inventory access comes from their
-- Inventory Lead role -- and Settings, which only the Super Admin opens).
--
-- Nobody holds office_admin yet (phase 4 assigns it), so no one's access
-- changes here. An admin can change any of these later in Settings > Roles &
-- access; `on conflict do nothing` keeps any change already made there.

insert into shared.module_access (role, module, level) values
  ('office_admin', 'dashboard', 'view'),
  ('office_admin', 'patients', 'edit'),
  ('office_admin', 'calendar', 'edit'),
  ('office_admin', 'staff', 'view'),
  ('office_admin', 'hr', 'view'),
  ('office_admin', 'compliance', 'edit'),
  ('office_admin', 'donors', 'edit'),
  ('office_admin', 'finance', 'edit')
on conflict (role, module) do nothing;
