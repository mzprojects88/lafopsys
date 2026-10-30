-- 0122: cash gift receipts as the BIR describes them, more bank accounts, and the data checks
-- Accounting confirms (decided with the user 30 Oct 2026).
--
-- BIR RMC 77-2024 (p. 6): a non-stock non-profit issues, for a donation, a supplementary document
-- -- "Non-VAT Official Receipt; Acknowledgment Receipt or Donation Receipt" -- naming the donor, the
-- date, the description of the donation and its intended purpose. An Invoice is for sales only. So
-- the cash gift document stays an acknowledgment receipt (series LAF-CSH kept), its title and the
-- purpose line come from Settings, and the sheet's paper number is "the paper receipt number".
--
--  1. shared.app_settings: cash_receipt_title, cash_receipt_purpose.
--  2. Receipts for anonymous gifts too (the paper booklet numbers them); editors may set or correct
--     the paper receipt number.
--  3. ops.accounts: BPI and LandBank beside BDO, each with the tracker tab it reads; deposits carry
--     their account; the month close checks every account that has statements.
--  4. ops.data_checks: what the sync found wrong on the tracker or the ledgers, with the AI's
--     suggestion, decided by Accounting ("correct as is", "fixed on the sheet", "explained").

-- ---- 1. the document's title and purpose line ----
alter table shared.app_settings
  add column if not exists cash_receipt_title text not null default 'Acknowledgement Receipt',
  add column if not exists cash_receipt_purpose text not null default 'For the care of children with cancer and their carers housed by the foundation';

-- ---- 2. receipts: anonymous gifts too; the paper number can be set ----
create or replace function ops.issue_cash_ar(p_donation uuid)
returns text language plpgsql security definer
set search_path to 'ops', 'pg_temp' as $$
declare
  d ops.donations%rowtype;
  v_number text;
begin
  if not shared.module_editable('donors') then
    raise exception 'Only donors editors issue acknowledgment receipts.' using errcode = '42501';
  end if;
  select * into d from ops.donations where id = p_donation for update;
  if not found then
    raise exception 'Donation not found.' using errcode = 'P0002';
  end if;
  if d.kind <> 'cash' then
    raise exception 'Gifts in kind are receipted in LAF Inventory.' using errcode = '22023';
  end if;
  if exists (select 1 from ops.acknowledgment_receipts where donation_id = d.id) then
    raise exception 'This gift already has an acknowledgment receipt.' using errcode = '22023';
  end if;
  -- 0122: an anonymous gift is receipted as "Anonymous donor", as the paper booklet does.
  v_number := ops.next_doc_number('LAF-CSH', extract(year from d.date)::integer);
  insert into ops.acknowledgment_receipts (donation_id, sequence_number, entity, status, issued_at, issued_by, booklet_number, amount, currency)
  values (d.id, v_number, d.receiving_entity, 'issued', now(), auth.uid(), nullif(btrim(d.invoice_number), ''), d.total_value, d.currency);
  return v_number;
end;
$$;

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
     where g.kind = 'cash' and g.status = 'finalized' and g.donor_id is not null
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

-- The paper receipt number (the booklet's): set once by the sync from the sheet, corrected here.
create or replace function ops.set_receipt_paper_number(p_id uuid, p_number text)
returns void language plpgsql security definer
set search_path to 'ops', 'shared', 'pg_temp' as $$
declare
  v_number text := nullif(btrim(coalesce(p_number, '')), '');
begin
  if not shared.module_editable('donors') then
    raise exception 'Only donors editors change the paper receipt number.' using errcode = '42501';
  end if;
  if v_number is not null and length(v_number) > 60 then
    raise exception 'The paper receipt number is too long (60 characters at most).' using errcode = '23514';
  end if;
  update ops.acknowledgment_receipts set booklet_number = v_number where id = p_id;
  if not found then
    raise exception 'Receipt not found.' using errcode = 'P0002';
  end if;
  -- The gift keeps the same number, so the sheet check and the registers agree.
  update ops.donations d set invoice_number = v_number
    from ops.acknowledgment_receipts r where r.id = p_id and d.id = r.donation_id;
end;
$$;
revoke all on function ops.set_receipt_paper_number(uuid, text) from public, anon;
grant execute on function ops.set_receipt_paper_number(uuid, text) to authenticated;

-- ---- 3. more bank accounts ----
alter table ops.accounts
  add column if not exists bank_code text,
  add column if not exists tracker_tab text;
comment on column ops.accounts.tracker_tab is 'The Donation Tracker tab whose deposits belong to this account (0122): read by the sync when the tab exists.';
update ops.accounts set bank_code = 'BDO', tracker_tab = 'BDO_CASH DONATIONS' where id = '00000000-0000-4000-8000-00000000bd01';
insert into ops.accounts (id, name, entity, currency, type, bank_code, tracker_tab)
values ('00000000-0000-4000-8000-00000000b901', 'BPI Peso Account', 'PH_SEC', 'PHP', 'bank', 'BPI', 'BPI_CASH DONATIONS'),
       ('00000000-0000-4000-8000-000000001b01', 'LandBank Peso Account', 'PH_SEC', 'PHP', 'bank', 'LBP', 'LANDBANK_CASH DONATIONS')
on conflict (id) do nothing;

alter table ops.cash_deposits
  add column if not exists account_id uuid not null default '00000000-0000-4000-8000-00000000bd01' references ops.accounts (id);
create index if not exists cash_deposits_account_idx on ops.cash_deposits (account_id, deposit_date);

-- The BDO line keys stay as they were (the reconciliation links hang off those rows); another
-- account's keys carry its bank code so the same date, amount and number on two banks never clash.
create or replace function ops.receive_cash_deposits(p_year integer, p_lines jsonb, p_account uuid default '00000000-0000-4000-8000-00000000bd01')
returns jsonb language plpgsql security definer
set search_path to 'ops', 'pg_temp' as $$
declare
  had integer;
  n integer;
  removed integer;
  v_prefix text;
begin
  if jsonb_typeof(p_lines) is distinct from 'array' then
    raise exception 'Expected a list of lines.' using errcode = '22023';
  end if;
  select case when bank_code = 'BDO' then '' else bank_code || '|' end into v_prefix from ops.accounts where id = p_account;
  if v_prefix is null then
    raise exception 'That bank account is not on file.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(840110);
  n := jsonb_array_length(p_lines);
  select count(*) into had from ops.cash_deposits where year = p_year and account_id = p_account;
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
    select v_prefix || concat_ws('|', p_year::text, to_char(x.date, 'YYYY-MM-DD'), (x.amount::numeric(12, 2))::text, coalesce(btrim(x.invoice_number), '')) as base
  ) k;
  delete from ops.cash_deposits d where d.year = p_year and d.account_id = p_account and not exists (select 1 from new_deposits t where t.line_key = d.line_key);
  get diagnostics removed = row_count;
  insert into ops.cash_deposits (year, account_id, line_key, sheet_row, deposit_date, amount, donor_name, invoice_number, slip_named, slip_anonymous, notes, synced_at)
  select year, p_account, line_key, sheet_row, deposit_date, amount, donor_name, invoice_number, slip_named, slip_anonymous, notes, now() from new_deposits
  on conflict (line_key) do update set sheet_row = excluded.sheet_row, donor_name = excluded.donor_name, slip_named = excluded.slip_named,
    slip_anonymous = excluded.slip_anonymous, notes = excluded.notes, synced_at = now();
  return jsonb_build_object('status', 'received', 'lines', n, 'removed', removed);
end;
$$;
revoke all on function ops.receive_cash_deposits(integer, jsonb, uuid) from public, anon, authenticated;
grant execute on function ops.receive_cash_deposits(integer, jsonb, uuid) to service_role;
drop function if exists ops.receive_cash_deposits(integer, jsonb);

-- The month close: every account that has statement lines must reach the month's end.
create or replace function ops.month_close_checklist(p_month text)
returns jsonb language plpgsql stable security definer
set search_path to 'ops', 'shared', 'pg_temp' as $$
declare
  v_start date;
  v_next date;
  v_confirm_from numeric;
  v_unconfirmed int;
  v_unreconciled int;
  v_unposted int;
  v_note record;
  v_drivers_ok boolean;
  v_statement_ok boolean;
  v_statement_detail text;
begin
  if not (shared.module_viewable('finance', 'executive') or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'The monthly close is for finance and executive viewers' using errcode = '42501';
  end if;
  if p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Month must be yyyy-MM';
  end if;
  v_start := to_date(p_month || '-01', 'YYYY-MM-DD');
  v_next := (v_start + interval '1 month')::date;
  select coalesce((exec_summary ->> 'confirm_from')::numeric, 10000) into v_confirm_from from shared.app_settings where id;

  -- Per account with any statement line: its last line in the month reaches the last banking days, or a later month is in.
  with acct as (
    select a.id, coalesce(a.bank_code, a.name) as label,
           (select max(t.posting_date) from ops.bank_transactions t where t.account_id = a.id and t.posting_date >= v_start and t.posting_date < v_next) as last_line,
           exists (select 1 from ops.bank_transactions t where t.account_id = a.id and t.posting_date >= v_next) as later
    from ops.accounts a
    where exists (select 1 from ops.bank_transactions t where t.account_id = a.id)
  )
  select bool_and(last_line is not null and (last_line >= v_next - 3 or later)),
         string_agg(label || ': ' || case when last_line is null then 'no lines' else 'last line ' || to_char(last_line, 'Mon DD') end, ' · ' order by label)
    into v_statement_ok, v_statement_detail
  from acct;
  v_statement_ok := coalesce(v_statement_ok, false);
  v_statement_detail := coalesce(v_statement_detail, 'No statement lines yet');

  select count(*) into v_unconfirmed from ops.bank_transactions t
    where t.posting_date >= v_start and t.posting_date < v_next and t.debit >= v_confirm_from and not t.purpose_confirmed;
  select * into v_note from ops.finance_month_notes n where n.month = p_month;
  v_drivers_ok := v_note.confirmed_at is not null and coalesce(v_note.drivers, '') <> ''
    and (v_note.draft is null or btrim(v_note.draft) = btrim(v_note.drivers) or v_note.draft_at <= v_note.confirmed_at);
  select count(*) into v_unreconciled from ops.bank_transactions t
    where t.posting_date >= v_start and t.posting_date < v_next and t.credit > 0 and t.category is null and t.donation_id is null and t.deposit_id is null;
  select count(*) into v_unposted from ops.cash_gift_lines l
    where l.kind = 'cash' and l.date >= v_start and l.date < v_next
      and not exists (select 1 from ops.donations d where d.source_id = 'sheet:' || l.source || ':' || l.line_key);

  return jsonb_build_object(
    'month', p_month,
    'items', jsonb_build_array(
      jsonb_build_object('key', 'statement', 'label', 'Bank statements uploaded to the month''s end', 'done', v_statement_ok, 'detail', v_statement_detail),
      jsonb_build_object('key', 'purposes', 'label', 'Large payments'' purposes confirmed', 'done', v_statement_ok and v_unconfirmed = 0,
                         'detail', v_unconfirmed || ' payment' || case when v_unconfirmed = 1 then '' else 's' end || ' of PHP ' || trim(to_char(v_confirm_from, 'FM999,999,999')) || ' or more still to confirm'),
      jsonb_build_object('key', 'drivers', 'label', 'Key monthly drivers confirmed', 'done', v_drivers_ok,
                         'detail', case when v_drivers_ok then 'Confirmed' when v_note.draft is not null then 'A suggestion is waiting' else 'Not written yet' end),
      jsonb_build_object('key', 'reconcile', 'label', 'Bank credits reconciled', 'done', v_statement_ok and v_unreconciled = 0,
                         'detail', v_unreconciled || ' credit' || case when v_unreconciled = 1 then '' else 's' end || ' to reconcile'),
      jsonb_build_object('key', 'gifts', 'label', 'Cash gifts posted under confirmed names', 'done', v_unposted = 0,
                         'detail', v_unposted || ' gift' || case when v_unposted = 1 then '' else 's' end || ' waiting for a name')
    ),
    'ready', v_statement_ok and v_unconfirmed = 0 and v_drivers_ok and v_unreconciled = 0 and v_unposted = 0
  );
end;
$$;

-- ---- 4. data checks ----
create table if not exists ops.data_checks (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  kind text not null,
  severity text not null check (severity in ('error', 'warning', 'info')),
  title text not null,
  details jsonb not null default '{}'::jsonb,
  suggestion text,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  -- open: waiting for Accounting; correct / fixed / explained: Accounting's answer; cleared: the sync no longer finds it.
  status text not null default 'open' check (status in ('open', 'correct', 'fixed', 'explained', 'cleared')),
  decided_by uuid references shared.staff (id),
  decided_at timestamptz,
  note text
);
comment on table ops.data_checks is 'What the Donation Tracker sync found inconsistent (0122): the paper receipt series, unreadable rows, statements behind. The AI suggests what it probably is; Accounting decides.';
alter table ops.data_checks enable row level security;
create policy "finance and donors viewers read data checks" on ops.data_checks for select to authenticated
  using ((select shared.module_viewable(variadic array['finance', 'donors'])));
revoke all on ops.data_checks from anon, authenticated;
grant select on ops.data_checks to authenticated;
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'ops' and tablename = 'data_checks') then
    alter publication supabase_realtime add table ops.data_checks;
  end if;
end $$;

-- The sync's findings (service role): new ones open, known ones keep their decision, absent ones clear.
create or replace function ops.record_data_checks(p_findings jsonb)
returns jsonb language plpgsql security definer
set search_path to 'ops', 'pg_temp' as $$
declare
  v_cleared integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only the sync records data checks.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_findings) is distinct from 'array' then
    raise exception 'Expected a list of findings.' using errcode = '22023';
  end if;
  drop table if exists new_checks;
  create temp table new_checks on commit drop as
  select x.key, x.kind, x.severity, left(x.title, 200) as title, coalesce(x.details, '{}'::jsonb) as details
  from jsonb_to_recordset(p_findings) as x(key text, kind text, severity text, title text, details jsonb);
  insert into ops.data_checks (key, kind, severity, title, details)
  select key, kind, severity, title, details from new_checks
  on conflict (key) do update set last_seen = now(), title = excluded.title, details = excluded.details, severity = excluded.severity,
    -- A finding that had cleared and is back is open again; a decided one keeps its decision.
    status = case when ops.data_checks.status = 'cleared' then 'open' else ops.data_checks.status end;
  update ops.data_checks c set status = 'cleared' where c.status = 'open' and not exists (select 1 from new_checks n where n.key = c.key);
  get diagnostics v_cleared = row_count;
  return jsonb_build_object('seen', (select count(*) from new_checks), 'cleared', v_cleared);
end;
$$;
revoke all on function ops.record_data_checks(jsonb) from public, anon, authenticated;
grant execute on function ops.record_data_checks(jsonb) to service_role;

create or replace function ops.decide_data_check(p_id uuid, p_status text, p_note text default null)
returns void language plpgsql security definer
set search_path to 'ops', 'shared', 'pg_temp' as $$
begin
  if not (shared.module_editable('finance') or shared.module_editable('donors') or shared.has_power('finance_work')) then
    raise exception 'Only Accounting (finance or donors editors) decides a data check.' using errcode = '42501';
  end if;
  if p_status not in ('correct', 'fixed', 'explained', 'open') then
    raise exception 'Unknown decision %', p_status using errcode = '22023';
  end if;
  if p_status = 'explained' and length(btrim(coalesce(p_note, ''))) < 3 then
    raise exception 'Say what explains it.' using errcode = '23514';
  end if;
  update ops.data_checks
     set status = p_status, note = nullif(btrim(coalesce(p_note, '')), ''),
         decided_by = case when p_status = 'open' then null else auth.uid() end,
         decided_at = case when p_status = 'open' then null else now() end
   where id = p_id;
  if not found then
    raise exception 'Check not found.' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function ops.decide_data_check(uuid, text, text) from public, anon;
grant execute on function ops.decide_data_check(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
