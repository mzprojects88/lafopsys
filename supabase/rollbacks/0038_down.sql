-- Reverses 0038: drops the HR settings columns. Values are lost; re-apply
-- restores the defaults.

alter table shared.app_settings
  drop column payroll_pay_date_rule,
  drop column payroll_contribution_cutoff,
  drop column tardiness_grace_minutes,
  drop column leave_vl_days_per_year,
  drop column leave_sl_days_per_year,
  drop column leave_vl_convertible,
  drop column minimum_wage_region;
