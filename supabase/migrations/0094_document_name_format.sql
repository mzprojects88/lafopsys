-- 0094: how a staff name prints on each document (decided by the user 2026-10-14).
-- Per document type, the full name alone or the full name with the job title; chosen in
-- Settings > Documents. {} = every document as it prints today (lib/utils/staff-name.ts holds the
-- list and the defaults). Admins only, through the existing app_settings update policy.
-- Rollback: alter table shared.app_settings drop column document_names;
alter table shared.app_settings add column if not exists document_names jsonb not null default '{}'::jsonb;
comment on column shared.app_settings.document_names is 'Per document key: "name" or "name_title" (0094). Missing = the document''s default.';
