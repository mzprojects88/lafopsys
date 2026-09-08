-- Reverses 0043: the compliance items, every filing, and the three
-- settings columns are lost.

drop table if exists hr.compliance_filings;
drop table if exists hr.compliance_items;

alter table shared.app_settings
  drop column if exists compliance_pen_last_digit,
  drop column if exists compliance_employer_initial,
  drop column if exists compliance_tracking_from;
