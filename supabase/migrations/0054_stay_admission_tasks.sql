-- 0054: the social worker's admission tasks belong to the STAY, not the
-- patient (Phase D). A family is oriented every time they are admitted --
-- fully the first time, a shorter reminder when they come back -- so the
-- ticks must start again with each stay.
--
--   * ops.orientation_topics.returnee_too: this topic is also covered with a
--     returning family. Topics are the org's own list (0007 seeded none).
--   * ops.stay_orientation_checks replaces ops.patient_orientation_checks
--     (empty in production): one tick per stay and topic, signed and timed
--     by the database.
-- Documents stay per patient: an ID or a consent form is collected once.
-- Rollback: supabase/rollbacks/0054_down.sql.

alter table ops.orientation_topics
  add column returnee_too boolean not null default true;

-- Never used: the checklist has had no topics to tick.
drop table ops.patient_orientation_checks;

create table ops.stay_orientation_checks (
  stay_id uuid not null references ops.stays (id) on delete cascade,
  topic_id uuid not null references ops.orientation_topics (id) on delete cascade,
  covered_at timestamptz not null default now(),
  covered_by_staff_id uuid references shared.staff (id),
  primary key (stay_id, topic_id)
);
create index stay_orientation_checks_stay_idx on ops.stay_orientation_checks (stay_id);

-- Who covered it, and when, is the database's to say.
create or replace function ops.stamp_orientation_check()
returns trigger
language plpgsql
as $$
begin
  new.covered_at := now();
  new.covered_by_staff_id := coalesce(auth.uid(), new.covered_by_staff_id);
  return new;
end;
$$;
create trigger stamp_orientation_check
  before insert or update on ops.stay_orientation_checks
  for each row execute function ops.stamp_orientation_check();

alter table ops.stay_orientation_checks enable row level security;
create policy "module read" on ops.stay_orientation_checks for select to authenticated
  using ((select shared.module_viewable('patients')));
create policy "module insert" on ops.stay_orientation_checks for insert to authenticated
  with check ((select shared.module_editable('patients')));
create policy "module update" on ops.stay_orientation_checks for update to authenticated
  using ((select shared.module_editable('patients'))) with check ((select shared.module_editable('patients')));
create policy "module delete" on ops.stay_orientation_checks for delete to authenticated
  using ((select shared.module_editable('patients')));
revoke all on ops.stay_orientation_checks from authenticated;
grant select, insert, update, delete on ops.stay_orientation_checks to authenticated;
alter publication supabase_realtime add table ops.stay_orientation_checks;

notify pgrst, 'reload schema';
