-- Reverses 0042: every pay item, run, payslip and YTD opening is lost.
-- Payslips are money records: export first if any run was approved.

drop table if exists hr.ytd_openings;
drop table if exists hr.payslips;
drop function if exists hr.guard_payslip_write();
drop function if exists hr.run_is_settled(uuid);
drop table if exists hr.payroll_runs;
drop function if exists hr.guard_payroll_run_update();
drop table if exists hr.pay_items;
