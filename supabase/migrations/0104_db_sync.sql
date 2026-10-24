-- 0104: the two-way database sync, production wins (user, 2026-10-24).
--
-- After the 12 Oct move LAF Inventory's lafinventory.vercel.app kept writing to the old project (now
-- dev), so the two databases drifted for ten days. From now on /api/db-sync (the Operating System on
-- lafopsys) runs every hour: every table of arkos and Inventory, plus the staff logins, is compared
-- on both sides against what they last agreed on; new or changed rows are carried across, deletions
-- too, and a row changed on both keeps production's version (logged). A clash that breaks a rule
-- (a duplicate AR number, a double-booked bed) stops the run with nothing written.
--
--   1. sync.row_state: what both sides agreed on after the last run (table, key, hash of the shared
--      columns); sync.runs and sync.conflicts, which admins read in Settings > Database sync.
--   2. Every foreign key in ops / shared / hr / inventory becomes DEFERRABLE INITIALLY IMMEDIATE:
--      nothing changes for the apps, and the sync can apply a whole run in one transaction, checked
--      at commit, without ordering tables by hand.
--   3. The schedule: every hour at :20, only where the other scheduled syncs already run (production;
--      dev has none), so dev never calls the route too.

create schema sync;

create table sync.row_state (
  table_name text not null,
  pk text not null,
  hash text not null,
  primary key (table_name, pk)
);
create table sync.runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  trigger text not null check (trigger in ('cron', 'manual')),
  mode text not null default 'sync' check (mode in ('sync', 'dry_run', 'init')),
  status text not null default 'running' check (status in ('running', 'success', 'failed')),
  to_dev integer not null default 0,
  to_prod integer not null default 0,
  deleted_on_dev integer not null default 0,
  deleted_on_prod integer not null default 0,
  conflicts integer not null default 0,
  error text,
  note text
);
create table sync.conflicts (
  id bigserial primary key,
  run_id uuid not null references sync.runs (id) on delete cascade,
  table_name text not null,
  pk text not null,
  what text not null
);
create index sync_conflicts_run_idx on sync.conflicts (run_id);

alter table sync.row_state enable row level security;
alter table sync.runs enable row level security;
alter table sync.conflicts enable row level security;
create policy "admins read sync runs" on sync.runs for select to authenticated using (shared.has_role('admin'));
create policy "admins read sync conflicts" on sync.conflicts for select to authenticated using (shared.has_role('admin'));
grant usage on schema sync to authenticated;
grant select on sync.runs, sync.conflicts to authenticated;
-- row_state: the sync's own, written with the service role; nobody else reads it.

-- ---- 2. foreign keys checked at commit when the sync asks ----
do $$
declare r record;
begin
  for r in
    select n.nspname, t.relname, c.conname
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
     where c.contype = 'f' and not c.condeferrable and n.nspname in ('ops', 'shared', 'hr', 'inventory')
  loop
    execute format('alter table %I.%I alter constraint %I deferrable initially immediate', r.nspname, r.relname, r.conname);
  end loop;
end $$;

-- ---- 3. the schedule (production only: where the sheet syncs are scheduled) ----
do $$
begin
  if exists (select 1 from cron.job where jobname = 'house-sheet-sync') then
    perform cron.schedule(
      'db-sync',
      '20 * * * *',
      $job$
      select net.http_post(
        url := 'https://lafopsys.vercel.app/api/db-sync',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (
            select decrypted_secret from vault.decrypted_secrets
            where name = 'calendar_sync_secret' limit 1
          )
        ),
        body := '{"trigger":"cron"}'::jsonb,
        timeout_milliseconds := 290000
      );
      $job$
    );
  end if;
end $$;

notify pgrst, 'reload schema';
