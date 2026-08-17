-- Phase 1.3: org-editable orientation-topics checklist. Deliberately seeded
-- empty -- the real content of what staff cover with a family on arrival day
-- is unknown org policy, not something to fabricate. Staff populate the real
-- topic list themselves as they define it; this table just gives that list a
-- durable home and lets it be checked off per patient.

create table ops.orientation_topics (
  id uuid primary key default gen_random_uuid(),
  topic text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table ops.patient_orientation_checks (
  patient_id uuid not null references ops.patients (id) on delete cascade,
  topic_id uuid not null references ops.orientation_topics (id) on delete cascade,
  covered_at timestamptz not null default now(),
  covered_by_staff_id uuid references shared.staff (id),
  primary key (patient_id, topic_id)
);

alter table ops.orientation_topics enable row level security;
alter table ops.patient_orientation_checks enable row level security;

create policy "authenticated staff full access" on ops.orientation_topics for all to authenticated using (true) with check (true);
create policy "authenticated staff full access" on ops.patient_orientation_checks for all to authenticated using (true) with check (true);

create index on ops.patient_orientation_checks (patient_id);
