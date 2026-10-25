-- 0108: roll-out step 1 -- Reports and Analytics open to staff (user, 2026-10-25).
--
-- The hidden modules come off NEXT_PUBLIC_HIDDEN_ROUTES one at a time; before each step the roles
-- that should see the module get their page levels here (the grid in Settings > Roles & access
-- can change them later). Pages not built yet are taken away from every role so that opening a
-- module never shows an unfinished page.

-- Not built yet (S10, after launch): nobody but the Super Admin sees them.
delete from shared.role_page_access
 where page in ('reports.builder', 'reports.schedule', 'finance.accounts', 'finance.budget', 'finance.close', 'finance.cost_per_outcome');

-- Reports: social workers and the office admin prepare (NCH billing follows its own power);
-- drivers and house staff read; finance edit and board view already seeded by 0093.
insert into shared.role_page_access (role, page, level) values
  ('social_worker', 'reports.catalogue', 'edit'), ('social_worker', 'reports.documents', 'edit'),
  ('office_admin', 'reports.catalogue', 'edit'), ('office_admin', 'reports.documents', 'edit'),
  ('ceo', 'reports.catalogue', 'view'), ('ceo', 'reports.documents', 'view'),
  ('driver', 'reports.catalogue', 'view'), ('house_staff', 'reports.catalogue', 'view'),
  -- Analytics: the office admin and the CEO join the roles 0093 gave.
  ('office_admin', 'analytics.dashboard', 'view'), ('ceo', 'analytics.dashboard', 'view')
on conflict do nothing;
