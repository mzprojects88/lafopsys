-- Org-wide HR numbers, on the single-row shared.app_settings like the
-- attendance policy (0029) and the calendar sync switch (0034). Reference
-- data with history lives in hr.* (0037); these are the few knobs that are
-- one value for the whole foundation.
--
-- payroll_pay_date_rule: when a semi-monthly cutoff is paid.
--   {"kind":"offset","days":5}            -> 5 days after the cutoff ends
--   {"kind":"fixed","first":20,"second":5} -> the 1-15 cutoff on the 20th,
--                                             the 16-EOM cutoff on the 5th
--   The bank statement shows both cutoffs paid 2-6 days after they end, so
--   the default is an offset of 5. Art. 103: wages at least twice a month at
--   intervals not exceeding sixteen days -- both forms satisfy it.
-- payroll_contribution_cutoff: SSS/PhilHealth/Pag-IBIG are monthly figures;
--   'second' deducts the whole month on the second cutoff, 'split' halves
--   them across both.
-- tardiness_grace_minutes: lateness within this is not deducted. Zero by
--   default -- a grace period is a company policy, not a legal requirement,
--   and once given it cannot be withdrawn (Art. 100).
-- leave_vl/sl_days_per_year: the company vacation and sick leave. Five or
--   more VL days discharges the statutory Service Incentive Leave (Art.
--   95(b)); the default keeps it discharged whatever the headcount.
-- leave_vl_convertible: unused VL is paid out at year end / on separation
--   (the SIL is commutable by law; VL beyond it is company policy).
-- minimum_wage_region: which row of the minimum-wage table applies.

alter table shared.app_settings
  add column payroll_pay_date_rule jsonb not null default '{"kind": "offset", "days": 5}'::jsonb,
  add column payroll_contribution_cutoff text not null default 'second'
    check (payroll_contribution_cutoff in ('second', 'split')),
  add column tardiness_grace_minutes integer not null default 0
    check (tardiness_grace_minutes between 0 and 60),
  add column leave_vl_days_per_year numeric(4, 1) not null default 5
    check (leave_vl_days_per_year >= 0 and leave_vl_days_per_year <= 60),
  add column leave_sl_days_per_year numeric(4, 1) not null default 5
    check (leave_sl_days_per_year >= 0 and leave_sl_days_per_year <= 60),
  add column leave_vl_convertible boolean not null default true,
  add column minimum_wage_region text not null default 'NCR';
