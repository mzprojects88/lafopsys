-- 0124 Case files, phases 1-2 (decided 3 Nov 2026).
--
-- The social worker's case folder in the app: the intake sheet, progress notes, casework activity
-- reports, counseling recordings, home visits and monitoring, each a dated record of one form
-- (lib/case-files/forms.ts holds the fields), plus the scanned papers of the folder.
--
-- Who: ONLY the social worker reads or writes any of it -- not the Super Admin, not the CEO
-- (decision 3). The CEO is told how many approved records wait for a signature, nothing more.
-- The social worker reviews and approves every record (decision 2); an approved record is locked,
-- and reopening it keeps the approved version in its history.

-- 1. The paper folder's own number (LAF-YYYY-NNN-X) is already linked: ops.patients.legacy_code,
-- from the Patients Database sheet's CODE column (0057). PDFs default to case_number (LFCN).

-- 2. Scans and photos of the folder's papers.
create table if not exists ops.case_documents (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references ops.patients(id) on delete cascade,
  kind text not null check (kind in (
    'admission_slip', 'intake_sheet', 'case_study', 'birth_certificate', 'photo', 'pwd_id', 'parent_id',
    'intervention_plan', 'medical_record', 'progress_report', 'monitoring', 'referral_letter', 'case_conference',
    'psych_evaluation', 'legal_record', 'home_visit', 'casework_report', 'counseling_record', 'discharge',
    'school_module', 'signed_copy', 'other')),
  storage_path text not null unique,
  file_name text not null check (length(file_name) between 1 and 200),
  content_type text not null check (content_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  size_bytes integer not null check (size_bytes between 1 and 15728640),
  uploaded_by uuid default auth.uid() references shared.staff(id),
  uploaded_at timestamptz not null default now(),
  -- The AI reading (Settings switch, off by default): what it took the paper to be and found on it.
  ai_status text not null default 'off' check (ai_status in ('off', 'pending', 'read', 'failed')),
  ai_summary text check (ai_summary is null or length(ai_summary) <= 2000),
  ai_error text check (ai_error is null or length(ai_error) <= 500),
  read_at timestamptz,
  check (left(storage_path, 37) = patient_id::text || '/')
);
create index if not exists case_documents_patient on ops.case_documents (patient_id, uploaded_at);

-- 3. One row per form filled in (or session booked).
create table if not exists ops.case_records (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references ops.patients(id) on delete cascade,
  form text not null check (form in ('intake', 'progress_note', 'casework', 'counseling', 'home_visit', 'monitoring')),
  status text not null default 'draft' check (status in ('scheduled', 'draft', 'approved')),
  -- A booked session (phase 2): when and where; held_on is the day it took place.
  scheduled_at timestamptz,
  venue text check (venue is null or length(venue) <= 200),
  held_on date,
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 200000),
  source_document_id uuid references ops.case_documents(id) on delete set null,
  prepared_by uuid default auth.uid() references shared.staff(id),
  approved_by uuid references shared.staff(id),
  approved_at timestamptz,
  -- Recorded by the social worker once the CEO has signed the printed PDF.
  ceo_signed_on date,
  history jsonb not null default '[]'::jsonb check (jsonb_typeof(history) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'scheduled' or scheduled_at is not null),
  check (status <> 'approved' or (approved_by is not null and approved_at is not null and held_on is not null)),
  check (ceo_signed_on is null or status = 'approved')
);
create index if not exists case_records_patient on ops.case_records (patient_id, held_on);
create index if not exists case_records_open on ops.case_records (status, scheduled_at) where status <> 'approved';

-- Approval is the database's to stamp; an approved record only takes the CEO's signature date or a
-- reopen (which files the approved version into history). History is never written by the client.
create or replace function ops.guard_case_record()
returns trigger language plpgsql security invoker set search_path = ops, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'approved' then
      raise exception 'Save the record first, then approve it.' using errcode = '23514';
    end if;
    new.prepared_by := coalesce(auth.uid(), new.prepared_by);
    new.approved_by := null; new.approved_at := null; new.ceo_signed_on := null; new.history := '[]'::jsonb;
    return new;
  end if;
  new.history := old.history;
  new.prepared_by := old.prepared_by;
  if old.status = 'approved' then
    if new.status = 'approved' then
      if (new.data, new.held_on, new.venue, new.scheduled_at, new.form, new.patient_id, new.source_document_id)
         is distinct from (old.data, old.held_on, old.venue, old.scheduled_at, old.form, old.patient_id, old.source_document_id) then
        raise exception 'An approved record is locked: reopen it to change it.' using errcode = '23514';
      end if;
      new.approved_by := old.approved_by; new.approved_at := old.approved_at;
      return new;
    end if;
    -- Reopened: keep what was approved.
    new.history := old.history || jsonb_build_array(jsonb_build_object(
      'approved_at', old.approved_at, 'approved_by', old.approved_by, 'ceo_signed_on', old.ceo_signed_on,
      'held_on', old.held_on, 'venue', old.venue, 'data', old.data, 'reopened_at', now(), 'reopened_by', auth.uid()));
    new.approved_by := null; new.approved_at := null; new.ceo_signed_on := null;
    return new;
  end if;
  if new.status = 'approved' then
    new.approved_by := auth.uid(); new.approved_at := now();
  else
    new.approved_by := null; new.approved_at := null; new.ceo_signed_on := null;
  end if;
  return new;
end $$;
drop trigger if exists guard_case_record on ops.case_records;
create trigger guard_case_record before insert or update on ops.case_records
  for each row execute function ops.guard_case_record();
drop trigger if exists set_updated_at on ops.case_records;
create trigger set_updated_at before update on ops.case_records
  for each row execute function shared.set_updated_at();

-- 4. The social worker only, for every command. Approved records are never deleted.
alter table ops.case_records enable row level security;
alter table ops.case_documents enable row level security;
drop policy if exists "social worker reads" on ops.case_records;
drop policy if exists "social worker adds" on ops.case_records;
drop policy if exists "social worker changes" on ops.case_records;
drop policy if exists "social worker removes drafts" on ops.case_records;
create policy "social worker reads" on ops.case_records for select to authenticated using ((select shared.has_role('social_worker')));
create policy "social worker adds" on ops.case_records for insert to authenticated with check ((select shared.has_role('social_worker')));
create policy "social worker changes" on ops.case_records for update to authenticated
  using ((select shared.has_role('social_worker'))) with check ((select shared.has_role('social_worker')));
create policy "social worker removes drafts" on ops.case_records for delete to authenticated
  using ((select shared.has_role('social_worker')) and status <> 'approved');
drop policy if exists "social worker reads" on ops.case_documents;
drop policy if exists "social worker adds" on ops.case_documents;
drop policy if exists "social worker changes" on ops.case_documents;
drop policy if exists "social worker removes" on ops.case_documents;
create policy "social worker reads" on ops.case_documents for select to authenticated using ((select shared.has_role('social_worker')));
create policy "social worker adds" on ops.case_documents for insert to authenticated with check ((select shared.has_role('social_worker')));
create policy "social worker changes" on ops.case_documents for update to authenticated
  using ((select shared.has_role('social_worker'))) with check ((select shared.has_role('social_worker')));
create policy "social worker removes" on ops.case_documents for delete to authenticated using ((select shared.has_role('social_worker')));
grant select, insert, update, delete on ops.case_records, ops.case_documents to authenticated;

-- 5. The files: a private bucket, the social worker only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('case-files', 'case-files', false, 15728640, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "social worker reads case files" on storage.objects;
drop policy if exists "social worker adds case files" on storage.objects;
drop policy if exists "social worker removes case files" on storage.objects;
create policy "social worker reads case files" on storage.objects for select to authenticated
  using (bucket_id = 'case-files' and (select shared.has_role('social_worker')));
create policy "social worker adds case files" on storage.objects for insert to authenticated
  with check (bucket_id = 'case-files' and (select shared.has_role('social_worker')));
create policy "social worker removes case files" on storage.objects for delete to authenticated
  using (bucket_id = 'case-files' and (select shared.has_role('social_worker')));

-- 6. The CEO's reminder: what waits for a signature -- the form, the case number and the day it was
-- approved. No names, no content.
create or replace function ops.case_records_to_sign()
returns table (form text, case_number text, approved_at timestamptz)
language sql stable security definer set search_path = ops, shared, pg_temp as $$
  select r.form, p.case_number, r.approved_at
  from ops.case_records r join ops.patients p on p.id = r.patient_id
  where r.status = 'approved' and r.ceo_signed_on is null and shared.has_role('ceo')
  order by r.approved_at;
$$;
revoke all on function ops.case_records_to_sign() from public;
grant execute on function ops.case_records_to_sign() to authenticated;

-- 7. Reading uploaded papers with AI: off until the consent wording covers it (decision 5).
alter table shared.app_settings add column if not exists case_ai_reading boolean not null default false;
comment on column shared.app_settings.case_ai_reading is 'Send uploaded case documents to the AI to read and draft records (0124). Off by default: the intake consent must cover sharing with the AI provider first.';

-- 8. The social worker's Case sessions page (Patients › Case sessions); nobody else gets it.
insert into shared.role_page_access (role, page, level)
select 'social_worker', p.page, 'edit' from (values ('patients.sessions')) p(page)
on conflict do nothing;

-- 9. Live updates for the social worker's screens (RLS still decides who receives them).
do $$ begin
  alter publication supabase_realtime add table ops.case_records, ops.case_documents;
exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';
