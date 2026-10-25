-- 0110: the 2026 LAF Donation Tracker read into the app every half hour (user, 2026-10-25).
--
-- Accounting keys cash gifts on the tracker's CASH tab and deposits on BDO_CASH DONATIONS every day;
-- the Bank Statement tab is pasted when they get to it. /api/donors/tracker-sync reads the three tabs
-- by the sheet's public link (as the House and Programs sheets are read) until Settings switches the
-- CASH tab off (app_settings.cash_from_app_since: from that day gifts are entered in Donors > New
-- cash gift). Cash lines go through ops.receive_cash_lines (0084) as before; deposits land here;
-- bank rows join Finance > Bank Import's table. Every posted cash gift gets its LAF-CSH receipt
-- (user: the sheet's invoice number is the paper receipt; the app numbers and prints its own).

-- ---- 1. deposits (BDO_CASH DONATIONS) ----
create table ops.cash_deposits (
  id uuid primary key default gen_random_uuid(),
  year integer not null,
  line_key text not null unique,
  sheet_row integer,
  deposit_date date not null,
  amount numeric(12, 2) not null check (amount > 0),
  donor_name text,
  invoice_number text,
  slip_named text,
  slip_anonymous text,
  notes text,
  synced_at timestamptz not null default now()
);
create index cash_deposits_invoice_idx on ops.cash_deposits (invoice_number) where invoice_number is not null;
comment on table ops.cash_deposits is 'Deposits as the Donation Tracker''s BDO_CASH DONATIONS tab lists them (0110); written by the sync only.';
alter table ops.cash_deposits enable row level security;
create policy "donors and finance viewers read deposits" on ops.cash_deposits for select to authenticated
  using ((select shared.module_viewable(variadic array['donors', 'finance'])));
revoke all on ops.cash_deposits from anon, authenticated;
grant select on ops.cash_deposits to authenticated;

-- The sheet's lines replace the last read; a line that kept its key keeps its row (and the gift
-- linked to it). A read that lost more than half its lines is refused.
create or replace function ops.receive_cash_deposits(p_year integer, p_lines jsonb)
returns jsonb language plpgsql security definer
set search_path to 'ops', 'pg_temp' as $$
declare
  had integer;
  n integer;
  removed integer;
begin
  if jsonb_typeof(p_lines) is distinct from 'array' then
    raise exception 'Expected a list of lines.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(840110);
  n := jsonb_array_length(p_lines);
  select count(*) into had from ops.cash_deposits where year = p_year;
  if n = 0 or n > 20000 or n < had / 2.0 then
    raise exception 'Only % readable deposits (the last read had %); nothing changed.', n, had using errcode = '22023';
  end if;
  create temp table new_deposits on commit drop as
  select p_year as year,
         k.base || '#' || row_number() over (partition by k.base order by x.sheet_row) as line_key,
         x.sheet_row, x.date as deposit_date, x.amount::numeric(12, 2) as amount, left(btrim(x.donor_name), 200) as donor_name,
         nullif(left(btrim(x.invoice_number), 60), '') as invoice_number,
         nullif(left(btrim(x.slip_named), 500), '') as slip_named, nullif(left(btrim(x.slip_anonymous), 500), '') as slip_anonymous,
         nullif(left(btrim(x.notes), 500), '') as notes
  from jsonb_to_recordset(p_lines) as x(sheet_row integer, date date, donor_name text, amount numeric, invoice_number text, slip_named text, slip_anonymous text, notes text)
  cross join lateral (
    select concat_ws('|', p_year::text, to_char(x.date, 'YYYY-MM-DD'), (x.amount::numeric(12, 2))::text, coalesce(btrim(x.invoice_number), '')) as base
  ) k;
  delete from ops.cash_deposits d where d.year = p_year and not exists (select 1 from new_deposits t where t.line_key = d.line_key);
  get diagnostics removed = row_count;
  insert into ops.cash_deposits (year, line_key, sheet_row, deposit_date, amount, donor_name, invoice_number, slip_named, slip_anonymous, notes, synced_at)
  select year, line_key, sheet_row, deposit_date, amount, donor_name, invoice_number, slip_named, slip_anonymous, notes, now() from new_deposits
  on conflict (line_key) do update set sheet_row = excluded.sheet_row, donor_name = excluded.donor_name, slip_named = excluded.slip_named,
    slip_anonymous = excluded.slip_anonymous, notes = excluded.notes, synced_at = now();
  return jsonb_build_object('status', 'received', 'lines', n, 'removed', removed);
end;
$$;
revoke all on function ops.receive_cash_deposits(integer, jsonb) from public, anon, authenticated;
grant execute on function ops.receive_cash_deposits(integer, jsonb) to service_role;

-- ---- 2. the runs, and the switch ----
create table ops.tracker_sync_runs (
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
create index tracker_sync_runs_tab_idx on ops.tracker_sync_runs (tab, started_at desc);
alter table ops.tracker_sync_runs enable row level security;
create policy "donors and finance viewers read tracker runs" on ops.tracker_sync_runs for select to authenticated
  using ((select shared.module_viewable(variadic array['donors', 'finance'])));
revoke all on ops.tracker_sync_runs from anon, authenticated;
grant select on ops.tracker_sync_runs to authenticated;

alter table shared.app_settings add column cash_from_app_since date;
comment on column shared.app_settings.cash_from_app_since is 'From this day cash gifts are entered in the app and the tracker''s CASH tab is no longer read (0110). Null = the tracker is the record.';

-- ---- 3. links for reconciliation (gift <-> deposit <-> bank credit) ----
alter table ops.donations add column deposit_id uuid references ops.cash_deposits (id) on delete set null;
alter table ops.bank_transactions add column donation_id uuid references ops.donations (id) on delete set null;
create index donations_deposit_idx on ops.donations (deposit_id) where deposit_id is not null;
create index bank_transactions_donation_idx on ops.bank_transactions (donation_id) where donation_id is not null;

-- ---- 4. every posted cash gift gets its LAF-CSH receipt ----
-- Runs after each sync (service role) and after a donors editor confirms names: gifts in date order,
-- numbered in the gift's year, skipping anonymous donors (an AR names who gave) and gifts that have one.
create or replace function ops.issue_cash_ars_for_unreceipted()
returns integer language plpgsql security definer
set search_path to 'ops', 'pg_temp' as $$
declare
  d record;
  n integer := 0;
begin
  if not (shared.module_editable('donors') or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'Only donors editors issue acknowledgment receipts.' using errcode = '42501';
  end if;
  for d in
    select g.id, g.date, g.receiving_entity, g.invoice_number, g.total_value, g.currency
      from ops.donations g
      join ops.donors o on o.id = g.donor_id
     where g.kind = 'cash' and g.status = 'finalized' and o.type <> 'anonymous'
       and not exists (select 1 from ops.acknowledgment_receipts a where a.donation_id = g.id)
     order by g.date, g.created_at, g.id
     for update of g skip locked
  loop
    insert into ops.acknowledgment_receipts (donation_id, sequence_number, entity, status, issued_at, issued_by, booklet_number, amount, currency)
    values (d.id, ops.next_doc_number('LAF-CSH', extract(year from d.date)::integer), d.receiving_entity, 'issued', now(), auth.uid(), nullif(btrim(d.invoice_number), ''), d.total_value, d.currency);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function ops.issue_cash_ars_for_unreceipted() from public, anon;
grant execute on function ops.issue_cash_ars_for_unreceipted() to authenticated, service_role;

-- ---- 5. the half-hourly read (production only: where the House Sheet job runs) ----
do $$
begin
  if exists (select 1 from cron.job where jobname = 'house-sheet-sync') then
    perform cron.schedule(
      'tracker-sync',
      '5,35 * * * *',
      $job$
      select net.http_post(
        url := 'https://lafopsys.vercel.app/api/donors/tracker-sync',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'calendar_sync_secret' limit 1)
        ),
        body := '{"trigger":"cron"}'::jsonb,
        timeout_milliseconds := 240000
      );
      $job$
    );
  end if;
end $$;

notify pgrst, 'reload schema';
