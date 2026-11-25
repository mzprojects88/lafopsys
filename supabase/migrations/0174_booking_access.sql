-- 0174: who opens LAF Activity Center Bookings (owner, 25 Nov 2026): the Resident Social Worker and the Office
-- Admin process the requests; Accounting and the CEO see them; the Super Admin always may.
--
-- On production only (the database that runs the scheduled jobs, the same test 0161 uses). The access tables are
-- copied between the databases every hour: rows put on development first would be sent to production, which
-- refuses the new module until it has 0172, and the copy would stop. Development gets the rows from production
-- at the next copy after release. Until then the Super Admin alone sees the pages there.
--
-- Only the pages are seeded: the menu's own level follows the highest of its pages by itself (0093).

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from cron.job where jobname = 'house-sheet-sync') then
    insert into shared.role_page_access (role, page, level)
    select r.role, p.page, r.level from (values ('bookings.requests'), ('bookings.plan'), ('bookings.settings')) p(page)
    cross join (values ('social_worker', 'edit'), ('office_admin', 'edit'), ('finance', 'view'), ('ceo', 'view')) r(role, level)
    where exists (select 1 from shared.roles where key = r.role)
    on conflict do nothing;
  end if;
end $$;
