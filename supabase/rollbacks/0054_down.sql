-- Undo 0054: back to one orientation checklist per patient (0007's table,
-- with 0050's module policies).
alter publication supabase_realtime drop table ops.stay_orientation_checks;
drop table if exists ops.stay_orientation_checks;
drop function if exists ops.stamp_orientation_check();
alter table ops.orientation_topics drop column if exists returnee_too;

create table ops.patient_orientation_checks (
  patient_id uuid not null references ops.patients (id) on delete cascade,
  topic_id uuid not null references ops.orientation_topics (id) on delete cascade,
  covered_at timestamptz not null default now(),
  covered_by_staff_id uuid references shared.staff (id),
  primary key (patient_id, topic_id)
);
create index on ops.patient_orientation_checks (patient_id);
alter table ops.patient_orientation_checks enable row level security;
create policy "module read" on ops.patient_orientation_checks for select to authenticated
  using ((select shared.module_viewable(variadic '{patients}'::text[])));
create policy "module insert" on ops.patient_orientation_checks for insert to authenticated
  with check ((select shared.module_editable('patients')));
create policy "module update" on ops.patient_orientation_checks for update to authenticated
  using ((select shared.module_editable('patients'))) with check ((select shared.module_editable('patients')));
create policy "module delete" on ops.patient_orientation_checks for delete to authenticated
  using ((select shared.module_editable('patients')));
notify pgrst, 'reload schema';
