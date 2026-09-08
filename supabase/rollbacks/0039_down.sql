-- Reverses 0039: the pay-period calendar, every approved timesheet summary
-- and every schedule override are lost. 0042's payroll tables reference
-- pay_periods, so roll those back first.

drop table if exists hr.schedule_overrides;
drop table if exists hr.period_timesheets;
drop table if exists hr.pay_periods;
