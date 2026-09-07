-- Keep the master calendar fed from the Google Sheet until the sheet is retired.
--
-- 0032 imported the sheet once. Staff still maintain the schedule in the
-- sheet, and will until they have learned the app; in the meantime the app
-- must not fall behind it. Every two hours app/api/calendar/sync/route.ts
-- fetches the sheet's CSV export and reconciles it with ops.calendar_events
-- (lib/utils/calendar-sheet.ts holds the rules). This migration gives the
-- table what that needs, records each run, adds the switch that ends the
-- arrangement, and schedules the job.
--
-- The rule, so it is written down once: the sheet is the master for today
-- and what is to come; the app is the archive of what has been. A
-- sheet-sourced event dated today or later that leaves the sheet is hidden
-- (kept, restorable); a past one is left alone; an event created in the app
-- is never touched. Sheet events are read-only in the app while the switch
-- is on.
--
-- BASELINE FIRST. Rows created by the one-time import carry no created_by;
-- that is how this migration tells them from rows people made in the app.
-- The Sept 7 workbook must be imported before this runs.

-- ---------------------------------------------------------------------
-- 1. Provenance and sync bookkeeping
-- ---------------------------------------------------------------------

alter table ops.calendar_events
  add column source text not null default 'app' check (source in ('app', 'sheet')),
  -- The sheet has no row ids. This is `date|title|time` after normalising
  -- the title's case and spacing and the time's format, computed only in
  -- TypeScript (normaliseTime in lib/utils/calendar-sheet.ts) so there is
  -- exactly one definition of it.
  add column sheet_key text,
  add column time_key text,
  add column sheet_synced_at timestamptz,
  -- Set when an upcoming event vanished from the sheet. Hidden from every
  -- calendar view by the hook, not by RLS, so the sync log can still show it
  -- and an admin can restore it.
  add column sheet_removed_at timestamptz;

update ops.calendar_events set source = 'sheet' where created_by is null;

-- The (date, title, time) uniqueness stays for rows people make in the app,
-- under the same names (event-dialog.tsx matches the constraint name in the
-- error it explains). It comes OFF sheet rows: the first sync rewrites their
-- time text ("15:00" becomes the sheet's "3:00 PM") and rows hidden by the
-- sync still hold their old key. Sheet rows are unique by sheet_key instead.
alter table ops.calendar_events drop constraint calendar_events_natural_key;
drop index ops.calendar_events_natural_key_untimed;

create unique index calendar_events_natural_key
  on ops.calendar_events (date, title, time) where source = 'app';
create unique index calendar_events_natural_key_untimed
  on ops.calendar_events (date, title) where source = 'app' and time is null;
create unique index calendar_events_sheet_key_idx
  on ops.calendar_events (sheet_key) where source = 'sheet' and sheet_key is not null;
create index calendar_events_source_removed_idx
  on ops.calendar_events (source, sheet_removed_at);

-- ---------------------------------------------------------------------
-- 2. One row per check, so "last checked" and "last change" are facts
-- ---------------------------------------------------------------------

create table ops.calendar_sync_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running'
    check (status in ('running', 'success', 'unchanged', 'failed')),
  trigger text not null check (trigger in ('cron', 'manual')),
  triggered_by uuid references shared.staff (id),
  -- sha-256 of the CSV body. Equal to the previous run's means nothing
  -- changed and nothing is written: twelve cheap checks a day.
  csv_hash text,
  rows_seen integer not null default 0,
  inserted integer not null default 0,
  updated integer not null default 0,
  removed integer not null default 0,
  restored integer not null default 0,
  collisions integer not null default 0,
  duplicates integer not null default 0,
  error text
);

create index calendar_sync_runs_started_idx on ops.calendar_sync_runs (started_at desc);

alter table ops.calendar_sync_runs enable row level security;

create policy "staff read sync runs" on ops.calendar_sync_runs
  for select to authenticated
  using (shared.current_staff_role() is not null);

-- No insert, update or delete policy: only the route, with the service
-- role, writes here.
alter publication supabase_realtime add table ops.calendar_sync_runs;

-- ---------------------------------------------------------------------
-- 3. The switch that ends the arrangement
-- ---------------------------------------------------------------------

-- Off: the route does nothing when called, and every event -- sheet-sourced
-- or not -- becomes editable in the app. `source` stays as provenance.
alter table shared.app_settings
  add column calendar_sheet_sync_enabled boolean not null default true;

-- ---------------------------------------------------------------------
-- 4. The schedule
-- ---------------------------------------------------------------------

-- Vercel's plan allows a daily cron at most; Postgres can do every two
-- hours. pg_net posts to the route asynchronously; its result lands in
-- net._http_response, not in cron.job_run_details.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- The bearer secret is NOT in this file. It lives in Vault, put there by
-- scripts/set-calendar-sync-secret.mjs from the same value Vercel holds as
-- CALENDAR_SYNC_SECRET. While it is missing, the concatenation below is
-- null, the header is absent, the route answers 401 and records nothing --
-- and the calendar page's status line goes amber once two and a half hours
-- have passed without a run. That amber line is the signal for every silent
-- failure this job can have.
--
-- cron.schedule upserts by name, so re-applying this migration is harmless.
select cron.schedule(
  'calendar-sheet-sync',
  '0 */2 * * *',
  $$
  select net.http_post(
    url := 'https://lafopsys.vercel.app/api/calendar/sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'calendar_sync_secret' limit 1
      )
    ),
    body := '{"trigger":"cron"}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
