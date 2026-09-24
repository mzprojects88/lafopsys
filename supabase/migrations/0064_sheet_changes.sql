-- The app is the record (user, 2026-09-24). During the month staff use both,
-- the original Patients Database sheet is read every 30 minutes for
-- REFERENCE: what someone changed there since the last read becomes a
-- proposal here, explained by OpenAI, and a person with edit access to
-- Patients applies or dismisses it. Nothing on the sheet overwrites the app
-- any more (0057's "the sheet wins" is retired).
--
-- One row per child and field ("status", "carer", ...), or per new child.
-- `payload` is the exact write that Apply performs, worked out when the
-- change was found, so applying is a checked, dumb step.
--
-- Written by the sync (service role) and by app/api/patients/sheet-changes
-- after it has checked shared.module_editable('patients'); read by anyone
-- who can see Patients.

create table ops.sheet_changes (
  id uuid primary key default gen_random_uuid(),
  sheet_cn text not null,
  patient_id uuid references ops.patients (id) on delete cascade,
  kind text not null check (kind in ('field', 'new_child')),
  field text check (field in ('name', 'admitted', 'birthday', 'sex', 'address', 'province', 'status', 'illness', 'diagnosis', 'phase', 'carer', 'marital', 'priority', 'remarks', 'code')),
  label text not null,
  -- The sheet's cells before and after, and what the app holds now, as text.
  sheet_before text,
  sheet_after text not null,
  app_now text,
  payload jsonb not null,
  sheet_row jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'applied', 'dismissed')),
  ai_summary text,
  -- typo | format | real | serious (field); duplicate | new (new child)
  ai_flag text,
  ai_candidate_patient_id uuid references ops.patients (id) on delete set null,
  ai_confidence numeric(3, 2),
  ai_error text,
  detected_at timestamptz not null default now(),
  decided_by uuid references shared.staff (id),
  decided_at timestamptz,
  decision_note text,
  check ((kind = 'field') = (field is not null and patient_id is not null)),
  check ((status = 'pending') = (decided_at is null))
);

-- A repeat edit updates the waiting row rather than stacking a second one.
create unique index sheet_changes_one_pending_field on ops.sheet_changes (patient_id, field) where status = 'pending' and kind = 'field';
create unique index sheet_changes_one_pending_child on ops.sheet_changes (sheet_cn) where status = 'pending' and kind = 'new_child';
create index sheet_changes_status on ops.sheet_changes (status, detected_at desc);

alter table ops.sheet_changes enable row level security;

create policy "patients viewers read sheet changes" on ops.sheet_changes
  for select to authenticated
  using (shared.module_viewable('patients'));

revoke all on ops.sheet_changes from anon, authenticated;
grant select on ops.sheet_changes to authenticated;

alter publication supabase_realtime add table ops.sheet_changes;

-- The run log counts proposals now, not writes.
alter table ops.master_sheet_sync_runs
  add column changes_found integer not null default 0,
  add column new_children_found integer not null default 0;

notify pgrst, 'reload schema';
