-- The Compliances menu: the tracker leaves the HR sub-menu and becomes a
-- top-level page for the CEO, the super admin and finance. Finance can
-- read and record filings (mark in progress, submitted, with the
-- reference); adding or editing an obligation, and deleting a filing,
-- stays with admins and HR-flagged people (hr.is_hr_staff()).
--
-- Deadlines were checked against the agencies' published schedules on
-- 2026-09-08 (SEC MC 9-2026; the BIR 2026 calendar; DOLE Labor Advisory
-- 08-26 for the AERW; DOLE OSH reportorial rules; LGC s.167; NPC ASIR
-- advisories; DSWD MC 17 s.2018). What changes here:
--   * SEC AFS: the statute says 120 days after year-end, but the SEC sets a
--     calendar every year by circular. Items gain `due_overrides` -- dates
--     the agency published for a specific period, keyed by period key --
--     and the AFS for FY2025 carries MC 9-2026's May 29, 2026.
--   * BIR 2316: a second deadline, the signed copies to the BIR by Feb 28.
--   * DOLE OSH: the two dated reports are their own items (AEDR Jan 30,
--     AMR Mar 31); WAIR and the rest stay under the as-needed item.
--   * LGU sanitary permit rides on the Jan 20 business-permit renewal.
--   * DSWD (the workbook's empty last row): the annual accomplishment
--     report and financial report are due within the first quarter of the
--     following year (MC 17 s.2018 s.2.8; two consecutive misses draw
--     sanctions); the licence / accreditation renewal (filed 90 working
--     days before expiry) and the public solicitation permit are tracked
--     as needed. New category: social_welfare.
--
-- Submit-ahead rule: shared.app_settings.compliance_lead_days (default 10)
-- is how many days before the statutory date the foundation aims to file;
-- the calendar computes an internal target from it (lib/utils/compliance.ts
-- targetFor) and reports "behind" once the target passes.

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------

alter table shared.app_settings
  add column compliance_lead_days smallint not null default 10
    check (compliance_lead_days between 0 and 60);

-- ---------------------------------------------------------------------------
-- Items: a new category and per-period overrides
-- ---------------------------------------------------------------------------

alter table hr.compliance_items drop constraint if exists compliance_items_category_check;
alter table hr.compliance_items add constraint compliance_items_category_check
  check (category in ('employment', 'corporate', 'lgu', 'data_privacy', 'osh', 'social_welfare'));

alter table hr.compliance_items
  add column due_overrides jsonb not null default '{}'::jsonb
    check (jsonb_typeof(due_overrides) = 'object');

-- Verified corrections to seeded rows (notes carry the source).
update hr.compliance_items set
  due_overrides = '{"2025": "2026-05-29"}'::jsonb,
  notes = 'By statute within 120 calendar days after fiscal year-end (Apr 30 for a calendar year), but the SEC fixes the filing calendar each year by memorandum circular: MC 9-2026 set May 29, 2026 for FY2025 on eFAST. Enter each year''s MC date as an override. Audited FS when total assets or liabilities exceed P3 million.'
  where code = 'sec_afs';
update hr.compliance_items set
  notes = 'Given to every employee by January 31 of the following year (RR 11-2018 s.2.83), or with the final pay on separation. The signed copies go to the BIR separately, by February 28 (see the next item).'
  where code = 'bir_2316';
update hr.compliance_items set
  notes = 'Manual books: register before the initial ITR deadline or before use. Loose-leaf books: by January 15 of the following year. Computerised books: by January 30 (RMC 29-2019, through ORUS).'
  where code = 'bir_books';
update hr.compliance_items set
  notes = 'For the prior calendar year, as of December 31. Filing window May 15 - August 31 on aerw.nwpc.dole.gov.ph (DOLE Labor Advisory 08-26 for the 2025 report); the portal is also reached through reports.dole.gov.ph.'
  where code = 'dole_aerw';
update hr.compliance_items set
  name = 'Other OSH reports (WAIR, OSH committee, programme)',
  notes = 'Work Accident/Illness Report within 30 days of an accident causing disability; OSH committee reorganised every January; OSH programme on reports.dole.gov.ph. The dated annual reports (AEDR, AMR) are separate items.'
  where code = 'dole_osh';
update hr.compliance_items set
  frequency = 'annual',
  due_rule = '{"kind": "fixed", "month": 1, "day": 20, "yearOffset": 0}'::jsonb,
  notes = 'Renewed with the business permit: on or before January 20 (LGC s.167; a 25% surcharge applies after). Only if the LGU requires one for the facility.'
  where code = 'lgu_sanitary';
update hr.compliance_items set
  notes = 'Renewal of the mayor''s permit on or before January 20 of each year (Local Government Code s.167); local business tax paid late carries a 25% surcharge plus 2% monthly interest. Mandaluyong City.'
  where code = 'lgu_business_permit';
update hr.compliance_items set
  notes = 'March 31 following the reporting year, through the NPC Data Breach Notification Management System (DBNMS); required even with zero incidents. Applies because the foundation keeps patient and employee data.'
  where code = 'npc_asir';

insert into hr.compliance_items (code, agency, name, form, category, frequency, due_rule, applies, active, notes, sort_order) values
  ('bir_2316_submit', 'BIR', 'Signed 2316 copies to the BIR', 'BIR Form 2316 (employer copy)', 'employment', 'annual', '{"kind": "fixed", "month": 2, "day": 28, "yearOffset": 1}', 'if_employees', true, 'The employer''s duplicate copies, signed by employer and employee, with the certified list, by February 28 of the following year (RR 11-2018 s.2.83.1; eSubmission or the RDO).', 235),
  ('dole_aedr', 'DOLE', 'Annual Work Accident / Illness Exposure Data Report', 'AEDR (DOLE-BWC)', 'osh', 'annual', '{"kind": "fixed", "month": 1, "day": 30, "yearOffset": 1}', 'yes', true, 'On or before January 30 of the following year, with or without accidents (OSH Standards Rule 1050; DO 198-18), on reports.dole.gov.ph.', 425),
  ('dole_amr', 'DOLE', 'Annual Medical Report', 'AMR (DOLE-BWC)', 'osh', 'annual', '{"kind": "fixed", "month": 3, "day": 31, "yearOffset": 1}', 'conditional', false, 'On or before March 31 of the following year (OSH Standards Rule 1960), for establishments with occupational health personnel. Switch on once the foundation has a company physician or nurse.', 426),
  ('dswd_accomplishment', 'DSWD', 'Annual accomplishment report', 'Annex G', 'social_welfare', 'annual', '{"kind": "fixed", "month": 3, "day": 31, "yearOffset": 1}', 'yes', true, 'Within the first quarter of the succeeding year on the DSWD template (MC 17 s.2018 s.2.8); failure for two consecutive years draws sanctions. The system drafts the figures under Compliances > DSWD annual figures.', 700),
  ('dswd_financial', 'DSWD', 'Annual financial report', 'Annex E (DSWD-GF-010)', 'social_welfare', 'annual', '{"kind": "fixed", "month": 3, "day": 31, "yearOffset": 1}', 'yes', true, 'Submitted with the accomplishment report within the first quarter of the succeeding year: resources received by donor, itemised expenditures, balances (MC 17 s.2018). Audited FS when revenue is P600,000 or more. The system drafts the figures under Compliances > DSWD annual figures.', 710),
  ('dswd_license', 'DSWD', 'Registration / licence / accreditation renewal', 'DSWD RLA', 'social_welfare', 'as_needed', '{"kind": "as_needed"}', 'conditional', false, 'A licence is valid three years, accreditation three to seven; file the renewal with complete requirements at least 90 working days before expiry (MC 17 s.2018 s.2.11 / 3.9). Switch on and record the expiry when the certificate is issued.', 720),
  ('dswd_solicitation', 'DSWD', 'Public solicitation permit', 'DSWD solicitation permit', 'social_welfare', 'as_needed', '{"kind": "as_needed"}', 'conditional', false, 'Needed before soliciting donations from the public (PD 1564; DSWD AO 17 s.2020). Switch on when a public campaign is planned.', 730)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- Finance records filings
-- ---------------------------------------------------------------------------

create policy "finance reads compliance filings" on hr.compliance_filings
  for select to authenticated
  using (shared.current_staff_role() = 'finance');

create policy "finance records compliance filings" on hr.compliance_filings
  for insert to authenticated
  with check (shared.current_staff_role() = 'finance');

create policy "finance updates compliance filings" on hr.compliance_filings
  for update to authenticated
  using (shared.current_staff_role() = 'finance')
  with check (shared.current_staff_role() = 'finance');
