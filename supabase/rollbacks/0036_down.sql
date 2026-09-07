-- Reverses 0036. Destroys the employee master, its history, rates, schedules
-- and document checklist -- everything imported from the 201 masterlist.
-- Re-import with scripts/import-employee-201.mjs after re-applying.

drop table if exists hr.employee_documents;
drop table if exists hr.document_types;
drop table if exists hr.work_schedules;
drop table if exists hr.compensation;
drop function if exists hr.close_previous_effective_row();
drop table if exists hr.employment_events;
drop function if exists hr.apply_employment_event();
drop table if exists hr.employee_private;
drop function if exists hr.current_employee_id();
drop table if exists hr.employees;
