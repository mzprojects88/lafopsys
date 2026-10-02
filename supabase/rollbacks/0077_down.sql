-- Undo 0077: the fuel and expense log. Receipt rows in shared.files must go
-- first (their record type is dropped from the CHECK); their objects stay in B2.
delete from shared.files where record_type = 'vehicle_expense';

create or replace function shared.file_delete_allowed(m text)
returns boolean language sql stable security invoker set search_path = shared, hr, pg_temp as $$
  select case m
    when 'compliance' then hr.is_hr_staff()
    else shared.file_write_allowed(m)
  end;
$$;
create or replace function shared.file_write_allowed(m text)
returns boolean language sql stable security invoker set search_path = shared, hr, pg_temp as $$
  select case m
    when 'hr' then hr.is_hr_staff()
    when 'compliance' then hr.is_hr_staff() or shared.module_editable('compliance')
    when 'patients' then shared.module_editable('patients')
    when 'donors' then shared.module_editable('donors')
    else shared.module_editable('finance')
  end;
$$;
create or replace function shared.file_read_allowed(m text, rt text, rid uuid)
returns boolean language sql stable security invoker set search_path = shared, hr, pg_temp as $$
  select case m
    when 'hr' then hr.is_hr_staff() or (rt = 'employee' and rid is not null and rid = hr.current_employee_id())
    when 'compliance' then hr.is_hr_staff() or shared.module_viewable('compliance')
    when 'patients' then shared.module_viewable('patients')
    when 'donors' then shared.module_viewable('donors')
    else shared.module_viewable('finance')
  end;
$$;

alter table shared.files drop constraint files_check;
alter table shared.files add constraint files_check
  check (
    (record_type, module) in (
      ('employee', 'hr'), ('compliance_item', 'compliance'), ('patient', 'patients'),
      ('donor', 'donors'), ('bank_statement_import', 'finance'), ('general', 'reports'), ('ride', 'patients')
    )
  );
alter table shared.files drop constraint files_record_type_check;
alter table shared.files add constraint files_record_type_check
  check (record_type in ('employee', 'compliance_item', 'patient', 'donor', 'bank_statement_import', 'general', 'ride'));
alter table shared.files drop constraint files_module_check;
alter table shared.files add constraint files_module_check
  check (module in ('hr', 'compliance', 'patients', 'donors', 'finance', 'reports'));

drop table if exists ops.vehicle_expense_changes;
alter publication supabase_realtime drop table ops.vehicle_expenses;
drop table if exists ops.vehicle_expenses;
drop function if exists ops.guard_vehicle_expense();
alter publication supabase_realtime drop table ops.vehicle_expense_kinds;
drop table if exists ops.vehicle_expense_kinds;
notify pgrst, 'reload schema';
