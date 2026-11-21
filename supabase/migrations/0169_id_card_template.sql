-- 0169: the Patient ID Maker (owner, 21 Nov 2026). "Settings ... generate a Patient ID Template that will be
-- used for all patients, so that we don't need to upload a design but download the ID and print it, it could
-- be individual printing or bulk printing."
--   1. shared.app_settings.id_card_template: the one design every card prints with (texts, which lines show,
--      a theme from the LAF palette, the print layout). Empty = the LAF design of 18 Nov. The app reads it
--      through lib/utils/id-card-template.ts, which drops anything unknown and cuts each text to its limit.
--      Written by the Super Admin only: the existing "admins manage app settings" policy, and the server
--      action checks the role too. Cards already printed keep working: the QR never changes.
--   2. The page Patients > ID cards (bulk issue and print): the Patients editors.

alter table shared.app_settings add column if not exists id_card_template jsonb
  check (id_card_template is null or (jsonb_typeof(id_card_template) = 'object' and pg_column_size(id_card_template) < 8000));

insert into shared.role_page_access (role, page, level)
select r.role, p.page, r.level from (values ('patients.id_cards')) p(page)
cross join (values ('social_worker', 'edit'), ('office_admin', 'edit')) r(role, level)
where exists (select 1 from shared.roles where key = r.role)
on conflict do nothing;
