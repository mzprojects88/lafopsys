-- Undo 0050: back to the blanket "lafopsys staff full access" policy on every
-- table 0050 took over, the role-named policies it rewrote, and the
-- role-named functions. Run 0049_down.sql separately if check-in goes too.

do $$
declare
  t text;
  roles text := $r$('admin','social_worker','house_staff','driver','finance','board','volunteer')$r$;
begin
  for t in select distinct tablename from pg_policies where schemaname = 'ops' and policyname = 'module read'
  loop
    execute format('drop policy "module read" on ops.%I', t);
    execute format('drop policy "module insert" on ops.%I', t);
    execute format('drop policy "module update" on ops.%I', t);
    execute format('drop policy "module delete" on ops.%I', t);
    execute format('create policy "lafopsys staff full access" on ops.%I for all to authenticated using (shared.current_staff_role() in %s) with check (shared.current_staff_role() in %s)', t, roles, roles);
  end loop;
end $$;

drop policy "calendar editors insert" on ops.calendar_events;
drop policy "calendar editors update" on ops.calendar_events;
drop policy "calendar editors delete" on ops.calendar_events;
create policy "admin and social workers manage calendar" on ops.calendar_events for all to authenticated
  using (shared.current_staff_role() in ('admin', 'social_worker')) with check (shared.current_staff_role() in ('admin', 'social_worker'));

drop policy "patients viewers read the house sheet" on ops.house_sheet_people;
drop policy "patients editors review the house sheet" on ops.house_sheet_people;
drop policy "patients viewers read house sheet runs" on ops.house_sheet_sync_runs;
create policy "patient staff read the house sheet" on ops.house_sheet_people for select to authenticated
  using (shared.current_staff_role() in ('admin', 'social_worker'));
create policy "patient staff review the house sheet" on ops.house_sheet_people for update to authenticated
  using (shared.current_staff_role() in ('admin', 'social_worker')) with check (shared.current_staff_role() in ('admin', 'social_worker'));
create policy "patient staff read house sheet runs" on ops.house_sheet_sync_runs for select to authenticated
  using (shared.current_staff_role() in ('admin', 'social_worker'));

drop policy "bed viewers read floor plan labels" on ops.floor_plan_labels;
create policy "lafopsys staff read floor plan labels" on ops.floor_plan_labels for select to authenticated
  using (shared.current_staff_role() in ('admin','social_worker','house_staff','driver','finance','board','volunteer'));

drop policy "finance viewers read imports" on ops.bank_statement_imports;
drop policy "finance editors import" on ops.bank_statement_imports;
create policy "finance readers" on ops.bank_statement_imports for select to authenticated
  using (shared.current_staff_role() in ('admin', 'finance', 'board'));
create policy "finance writers" on ops.bank_statement_imports for insert to authenticated
  with check (shared.current_staff_role() in ('admin', 'finance'));
drop policy "finance viewers read transactions" on ops.bank_transactions;
drop policy "finance editors add transactions" on ops.bank_transactions;
drop policy "finance editors change transactions" on ops.bank_transactions;
create policy "finance readers" on ops.bank_transactions for select to authenticated
  using (shared.current_staff_role() in ('admin', 'finance', 'board'));
create policy "finance writers" on ops.bank_transactions for insert to authenticated
  with check (shared.current_staff_role() in ('admin', 'finance'));
create policy "finance edit" on ops.bank_transactions for update to authenticated
  using (shared.current_staff_role() in ('admin', 'finance')) with check (shared.current_staff_role() in ('admin', 'finance'));
drop policy "finance editors insert month notes" on ops.finance_month_notes;
drop policy "finance editors update month notes" on ops.finance_month_notes;
drop policy "finance editors delete month notes" on ops.finance_month_notes;
create policy "finance write month notes" on ops.finance_month_notes for all to authenticated
  using (shared.current_staff_role() in ('admin', 'finance')) with check (shared.current_staff_role() in ('admin', 'finance'));

drop policy "compliance viewers read filings" on hr.compliance_filings;
drop policy "compliance editors record filings" on hr.compliance_filings;
drop policy "compliance editors update filings" on hr.compliance_filings;
create policy "finance reads compliance filings" on hr.compliance_filings for select to authenticated
  using (shared.current_staff_role() = 'finance');
create policy "finance records compliance filings" on hr.compliance_filings for insert to authenticated
  with check (shared.current_staff_role() = 'finance');
create policy "finance updates compliance filings" on hr.compliance_filings for update to authenticated
  using (shared.current_staff_role() = 'finance') with check (shared.current_staff_role() = 'finance');

drop policy "patients viewers read patient documents" on storage.objects;
drop policy "patients editors add patient documents" on storage.objects;
drop policy "patients editors change patient documents" on storage.objects;
drop policy "patients editors remove patient documents" on storage.objects;
create policy "authenticated staff full access to patient documents" on storage.objects for all to authenticated
  using (bucket_id = 'patient-documents') with check (bucket_id = 'patient-documents');

create or replace function shared.file_read_allowed(m text, rt text, rid uuid)
returns boolean language sql stable security invoker set search_path = shared, hr, pg_temp as $$
  select case m
    when 'hr' then hr.is_hr_staff() or (rt = 'employee' and rid is not null and rid = hr.current_employee_id())
    when 'compliance' then hr.is_hr_staff() or shared.current_staff_role() = 'finance'
    when 'patients' then shared.current_staff_role() in ('admin', 'social_worker')
    when 'donors' then shared.current_staff_role() in ('admin', 'finance')
    else shared.current_staff_role() in ('admin', 'finance', 'board')
  end;
$$;
create or replace function shared.file_write_allowed(m text)
returns boolean language sql stable security invoker set search_path = shared, hr, pg_temp as $$
  select case m
    when 'hr' then hr.is_hr_staff()
    when 'compliance' then hr.is_hr_staff() or shared.current_staff_role() = 'finance'
    when 'patients' then shared.current_staff_role() in ('admin', 'social_worker')
    when 'donors' then shared.current_staff_role() in ('admin', 'finance')
    else shared.current_staff_role() in ('admin', 'finance')
  end;
$$;

-- guard_unit_columns and check_in: re-run their bodies from 0047 and 0049.
-- (Both files are create-or-replace; apply those two function definitions.)

alter publication supabase_realtime drop table shared.module_access;
drop function shared.module_editable(text);
drop function shared.module_viewable(text[]);
drop function shared.module_level(text);
drop table shared.module_access;
drop function shared.guard_module_access();
notify pgrst, 'reload schema';
