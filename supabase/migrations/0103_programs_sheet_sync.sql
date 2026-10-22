-- 0103: the LAF Programs sheet syncs into the app until it is switched off (user, 2026-10-22).
--
-- Staff keep "LAF Programs 2026" every day: per patient per day, breakfast / lunch / dinner (2 =
-- patient + carer) on the month tabs, and the Care Cart tab. Like the House Sheet (0100), the sheet
-- is the record until Settings switches it off; from that day the app's own records count (House
-- Today's ticks; LAF Inventory's Meals and Care Cart).
--
--   1. ops.sheet_meals: every month-tab row (patient, carer, BN, breakfast/lunch/dinner as 0-2),
--      written only by /api/programs/sheet-sync with the service role. L-N / N-L are not meals.
--   2. shared.app_settings.programs_from_app_since: null = the sheet is the record and the sync runs;
--      a date = the sync stops and the app's records count from that day.
--   3. ops.meal_record: who was served each meal -- the sheet's rows (name matched to a child) before
--      that date, House Today's ticks from it on (and on a day the sheet has no rows).
--   4. ops.programs_sync_runs: one row per tab read (hash: an unchanged tab is skipped).
--   5. The schedule: every half hour, like the House Sheet.
-- The kitchen headcounts and Care Cart runs go straight into LAF Inventory's tables (Inventory 0065).

create table ops.sheet_meals (
  date date not null,
  name_key text not null,
  patient_name text not null,
  carer_name text,
  bn smallint,
  breakfast smallint not null default 0 check (breakfast between 0 and 6),
  lunch smallint not null default 0 check (lunch between 0 and 6),
  dinner smallint not null default 0 check (dinner between 0 and 6),
  sheet_row integer,
  first_synced_at timestamptz not null default now(),
  synced_at timestamptz not null default now(),
  primary key (date, name_key)
);
create index sheet_meals_name_idx on ops.sheet_meals (name_key);
alter table ops.sheet_meals enable row level security;
create policy "patients and house ops viewers read the sheet meals" on ops.sheet_meals
  for select to authenticated
  using ((select shared.module_viewable(variadic array['patients', 'house_ops'])));
revoke insert, update, delete on ops.sheet_meals from authenticated;
grant select on ops.sheet_meals to authenticated;
alter publication supabase_realtime add table ops.sheet_meals;

alter table shared.app_settings add column programs_from_app_since date;

create view ops.meal_record with (security_invoker = true) as
with cut as (
  select coalesce((select programs_from_app_since from shared.app_settings where id), 'infinity'::date) as since
)
select distinct on (h.matched_patient_id, sm.date, m.meal)
       h.matched_patient_id as patient_id, sm.date, m.meal, m.people, 'sheet'::text as source
  from ops.sheet_meals sm
  join ops.house_sheet_people h on h.name_key = sm.name_key
  cross join lateral (values ('breakfast', sm.breakfast), ('lunch', sm.lunch), ('dinner', sm.dinner)) m(meal, people)
 where m.people > 0 and sm.date < (select since from cut)
   and h.match_status in ('auto_matched', 'confirmed', 'encoded') and h.matched_patient_id is not null
union all
select ms.patient_id, ms.date, ms.meal, 2, 'app'
  from ops.meals_served ms
 where ms.date >= (select since from cut)
    or not exists (select 1 from ops.sheet_meals x where x.date = ms.date);
grant select on ops.meal_record to authenticated;

create table ops.programs_sync_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'success', 'failed')),
  trigger text not null check (trigger in ('cron', 'manual')),
  triggered_by uuid references shared.staff (id),
  tab text not null,
  csv_hash text,
  rows_seen integer not null default 0,
  written integer not null default 0,
  error text
);
create index programs_sync_runs_tab_idx on ops.programs_sync_runs (tab, started_at desc);
alter table ops.programs_sync_runs enable row level security;
create policy "house ops viewers read programs sync runs" on ops.programs_sync_runs
  for select to authenticated
  using ((select shared.module_viewable(variadic array['patients', 'house_ops'])));
revoke insert, update, delete on ops.programs_sync_runs from authenticated;
grant select on ops.programs_sync_runs to authenticated;

select cron.schedule(
  'programs-sheet-sync',
  '15,45 * * * *',
  $$
  select net.http_post(
    url := 'https://lafopsys.vercel.app/api/programs/sheet-sync',
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

notify pgrst, 'reload schema';
