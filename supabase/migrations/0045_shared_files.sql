-- The file library: every file the app uploads to the Backblaze bucket,
-- one row per object, organised by the main menu the file belongs to.
--
-- The bucket is private. The browser uploads straight to it with a URL the
-- server signs (Vercel caps a function's request body at 4.5 MB, so the
-- bytes cannot pass through the app), and every download is a signed link
-- that expires in minutes. This table is the only record of what is in
-- the bucket and who may see it: a row is inserted AS THE CALLER before the
-- upload starts (RLS refuses the wrong person here), sits at `pending`
-- until the server confirms the object arrived, and is deleted AS THE
-- CALLER before the object is removed.
--
-- Access follows the module the file belongs to, the same people who see
-- the record it hangs on:
--   hr          admins and HR-flagged people; an employee reads their own
--   compliance  admins, HR and finance read and add; admins and HR delete
--   patients    admins and social workers
--   donors      admins and finance (never the donor portal)
--   finance     admins and finance add; board reads as well
--   reports     the same as finance
-- Pending rows are visible only to their uploader, so a failed upload is
-- never listed for anyone else.
--
-- Compliance files hang on the OBLIGATION and the PERIOD (record_id =
-- compliance_items.id, sub_key = period key such as 2026-08), not on a
-- filing row: the tracker shows a deadline before anyone records a filing.
--
-- Folders and keys are built in lib/utils/file-paths.ts:
--   HR/201 Files/Dela Cruz, Juan (EMP-3005)/<id8>-<file name>
--   Compliances/BIR/2026/08 August/<id8>-<file name>

create table shared.files (
  id uuid primary key default gen_random_uuid(),
  module text not null check (module in ('hr', 'compliance', 'patients', 'donors', 'finance', 'reports')),
  record_type text not null check (record_type in ('employee', 'compliance_item', 'patient', 'donor', 'bank_statement_import', 'general')),
  record_id uuid,
  -- document_type_id for a 201 file, the period key for a compliance file, free text otherwise
  sub_key text,
  object_key text not null unique,
  -- the folder as the console shows it, a snapshot taken at upload time
  folder text not null,
  file_name text not null,
  content_type text not null,
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  status text not null default 'pending' check (status in ('pending', 'ready')),
  uploaded_by uuid not null references shared.staff (id),
  created_at timestamptz not null default now(),
  check (
    (record_type, module) in (
      ('employee', 'hr'), ('compliance_item', 'compliance'), ('patient', 'patients'),
      ('donor', 'donors'), ('bank_statement_import', 'finance'), ('general', 'reports')
    )
  ),
  check (record_type = 'general' or record_id is not null)
);

create index files_record_idx on shared.files (module, record_type, record_id);
create index files_folder_idx on shared.files (folder);

-- Who may read a file of this module (and, for HR, this record).
create or replace function shared.file_read_allowed(m text, rt text, rid uuid)
returns boolean
language sql
stable
security invoker
set search_path = shared, hr, pg_temp
as $$
  select case m
    when 'hr' then hr.is_hr_staff() or (rt = 'employee' and rid is not null and rid = hr.current_employee_id())
    when 'compliance' then hr.is_hr_staff() or shared.current_staff_role() = 'finance'
    when 'patients' then shared.current_staff_role() in ('admin', 'social_worker')
    when 'donors' then shared.current_staff_role() in ('admin', 'finance')
    else shared.current_staff_role() in ('admin', 'finance', 'board')
  end;
$$;

-- Who may add a file to this module.
create or replace function shared.file_write_allowed(m text)
returns boolean
language sql
stable
security invoker
set search_path = shared, hr, pg_temp
as $$
  select case m
    when 'hr' then hr.is_hr_staff()
    when 'compliance' then hr.is_hr_staff() or shared.current_staff_role() = 'finance'
    when 'patients' then shared.current_staff_role() in ('admin', 'social_worker')
    when 'donors' then shared.current_staff_role() in ('admin', 'finance')
    else shared.current_staff_role() in ('admin', 'finance')
  end;
$$;

-- Who may remove a file: the same, except compliance stays with admins and HR.
create or replace function shared.file_delete_allowed(m text)
returns boolean
language sql
stable
security invoker
set search_path = shared, hr, pg_temp
as $$
  select case m
    when 'compliance' then hr.is_hr_staff()
    else shared.file_write_allowed(m)
  end;
$$;

grant execute on function shared.file_read_allowed(text, text, uuid) to authenticated, service_role;
grant execute on function shared.file_write_allowed(text) to authenticated, service_role;
grant execute on function shared.file_delete_allowed(text) to authenticated, service_role;

alter table shared.files enable row level security;

create policy "files read" on shared.files
  for select to authenticated
  using (shared.file_read_allowed(module, record_type, record_id) and (status = 'ready' or uploaded_by = auth.uid()));

create policy "files insert" on shared.files
  for insert to authenticated
  with check (uploaded_by = auth.uid() and shared.file_write_allowed(module));

-- Only the uploader confirms (pending -> ready); nothing else about a row changes.
create policy "files confirm" on shared.files
  for update to authenticated
  using (uploaded_by = auth.uid())
  with check (uploaded_by = auth.uid() and shared.file_write_allowed(module));

create policy "files delete" on shared.files
  for delete to authenticated
  using (shared.file_delete_allowed(module));

alter publication supabase_realtime add table shared.files;
