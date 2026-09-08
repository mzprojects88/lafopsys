-- 0046: the house's Occupancy Tracker (a Google Sheet with one tab per day)
-- read into the app, each roster name resolved to a patient record.
--
-- One row per PERSON on the sheet (keyed by normalised name), not per day:
-- the same child is on the roster every day of a stay, and the decision
-- "this is patient #51" must be made once and survive a week away. The
-- sync route (service role) inserts and refreshes the sheet's own fields;
-- social workers and admins only ever change the review columns, and the
-- column grant plus a trigger make that a fact rather than a convention.
--
-- The model is asked only about names the deterministic pass cannot
-- settle; its suggestion is stored, never acted on, until a person confirms.
-- Rollback: supabase/rollbacks/0046_down.sql.

-- ---------------------------------------------------------------------
-- 1. People on the sheet
-- ---------------------------------------------------------------------

create table ops.house_sheet_people (
  id uuid primary key default gen_random_uuid(),
  -- normalised "last|first"; the identity of a name across days
  name_key text not null unique,
  row_no integer,
  patient_name text not null,
  carer_name text,
  relationship text,
  next_appointment_raw text,
  next_appointment_on date,
  treatment text,
  address text,
  laf_flag boolean not null default false,
  phone text,
  first_seen_on date not null,
  last_seen_on date not null,
  days_seen integer not null default 1,
  -- set when the person is not on the newest roster; cleared when they return
  off_sheet_at timestamptz,

  -- the review
  match_status text not null default 'unmatched'
    check (match_status in ('auto_matched', 'suggested', 'unmatched', 'confirmed', 'dismissed', 'encoded')),
  matched_patient_id uuid references ops.patients (id) on delete set null,
  match_method text check (match_method in ('exact', 'loose', 'ai', 'manual')),
  match_confidence numeric(3, 2) check (match_confidence between 0 and 1),
  ai_candidates jsonb,
  ai_reason text,
  ai_error text,
  ai_attempts integer not null default 0,
  referral_id uuid references ops.referrals (id) on delete set null,
  reviewed_by uuid references shared.staff (id),
  reviewed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index house_sheet_people_status_idx on ops.house_sheet_people (match_status);
create index house_sheet_people_patient_idx on ops.house_sheet_people (matched_patient_id);
create index house_sheet_people_on_sheet_idx on ops.house_sheet_people (last_seen_on desc) where off_sheet_at is null;

create trigger set_updated_at
  before update on ops.house_sheet_people
  for each row execute function shared.set_updated_at();

-- Reviewers change the decision, never the sheet's fields or the model's notes.
revoke insert, update, delete on ops.house_sheet_people from authenticated;
grant update (match_status, matched_patient_id, match_method, referral_id, reviewed_by, reviewed_at)
  on ops.house_sheet_people to authenticated;

-- A reviewer may only set match_status to a reviewed value, and must sign it.
create or replace function ops.house_sheet_review_guard()
returns trigger
language plpgsql
as $$
begin
  if current_setting('request.jwt.claims', true) is null or auth.uid() is null then
    return new;  -- the service role's own writes
  end if;
  if new.match_status not in ('confirmed', 'dismissed', 'encoded', 'unmatched') then
    raise exception 'A review can only confirm, dismiss, encode, or reopen a row' using errcode = '42501';
  end if;
  if new.match_status = 'confirmed' and new.matched_patient_id is null then
    raise exception 'Confirming needs a patient' using errcode = '23514';
  end if;
  if new.match_status = 'encoded' and new.referral_id is null then
    raise exception 'Encoding needs the referral' using errcode = '23514';
  end if;
  if new.reviewed_by is distinct from auth.uid() then
    raise exception 'A review is signed by the reviewer' using errcode = '42501';
  end if;
  new.reviewed_at := now();
  if new.match_status = 'confirmed' and new.match_method is null then
    new.match_method := 'manual';
  end if;
  return new;
end;
$$;

create trigger house_sheet_review_guard
  before update on ops.house_sheet_people
  for each row execute function ops.house_sheet_review_guard();

alter table ops.house_sheet_people enable row level security;

create policy "patient staff read the house sheet" on ops.house_sheet_people
  for select to authenticated
  using (shared.current_staff_role() in ('admin', 'social_worker'));

create policy "patient staff review the house sheet" on ops.house_sheet_people
  for update to authenticated
  using (shared.current_staff_role() in ('admin', 'social_worker'))
  with check (shared.current_staff_role() in ('admin', 'social_worker'));

-- No insert or delete policy: only the route, with the service role, writes rows.
alter publication supabase_realtime add table ops.house_sheet_people;

-- ---------------------------------------------------------------------
-- 2. One row per tab checked, so "last checked" is a fact
-- ---------------------------------------------------------------------

create table ops.house_sheet_sync_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running'
    check (status in ('running', 'success', 'unchanged', 'failed')),
  trigger text not null check (trigger in ('cron', 'manual')),
  triggered_by uuid references shared.staff (id),
  tab_date date,
  tab_gid text,
  csv_hash text,
  rows_seen integer not null default 0,
  inserted integer not null default 0,
  updated integer not null default 0,
  off_sheet integer not null default 0,
  returned integer not null default 0,
  auto_matched integer not null default 0,
  suggested integer not null default 0,
  unmatched integer not null default 0,
  ai_calls integer not null default 0,
  error text
);

create index house_sheet_sync_runs_started_idx on ops.house_sheet_sync_runs (started_at desc);
create index house_sheet_sync_runs_tab_idx on ops.house_sheet_sync_runs (tab_date, started_at desc);

revoke insert, update, delete on ops.house_sheet_sync_runs from authenticated;

alter table ops.house_sheet_sync_runs enable row level security;

create policy "patient staff read house sheet runs" on ops.house_sheet_sync_runs
  for select to authenticated
  using (shared.current_staff_role() in ('admin', 'social_worker'));

alter publication supabase_realtime add table ops.house_sheet_sync_runs;

-- ---------------------------------------------------------------------
-- 3. The switch
-- ---------------------------------------------------------------------

alter table shared.app_settings
  add column house_sheet_sync_enabled boolean not null default true;

-- ---------------------------------------------------------------------
-- 4. The schedule: every half hour, the newest tab only. An unchanged tab
--    costs one fetch and one run row. Uses the calendar sync's bearer
--    secret from Vault (the same value Vercel holds as CALENDAR_SYNC_SECRET).
-- ---------------------------------------------------------------------

select cron.schedule(
  'house-sheet-sync',
  '*/30 * * * *',
  $$
  select net.http_post(
    url := 'https://lafopsys.vercel.app/api/patients/house-sheet-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'calendar_sync_secret' limit 1
      )
    ),
    body := '{"trigger":"cron"}'::jsonb,
    timeout_milliseconds := 240000
  );
  $$
);
