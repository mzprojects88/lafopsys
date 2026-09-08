-- Reverses 0044: the finance policies, the seven added obligations (their
-- filings cascade), the per-period overrides, the lead-days setting, and
-- the social_welfare category. The note corrections on existing rows are
-- left as they are (text only).

drop policy if exists "finance reads compliance filings" on hr.compliance_filings;
drop policy if exists "finance records compliance filings" on hr.compliance_filings;
drop policy if exists "finance updates compliance filings" on hr.compliance_filings;

delete from hr.compliance_items
  where code in ('bir_2316_submit', 'dole_aedr', 'dole_amr', 'dswd_accomplishment', 'dswd_financial', 'dswd_license', 'dswd_solicitation');

update hr.compliance_items set
  frequency = 'as_needed',
  due_rule = '{"kind": "as_needed"}'::jsonb
  where code = 'lgu_sanitary';

alter table hr.compliance_items drop column if exists due_overrides;

alter table hr.compliance_items drop constraint if exists compliance_items_category_check;
alter table hr.compliance_items add constraint compliance_items_category_check
  check (category in ('employment', 'corporate', 'lgu', 'data_privacy', 'osh'));

alter table shared.app_settings drop column if exists compliance_lead_days;
