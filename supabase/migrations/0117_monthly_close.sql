-- 0117: Monthly close (Sprint 10; T-019, decided 27 Oct: the app answers the checklist, Close
-- locks the month, the Super Admin reopens with a reason).
--
-- A month is ready to close when the records say so:
--   1. the bank statement reaches the month's end;
--   2. every large debit's purpose is confirmed (the amount in Settings > Executive summary);
--   3. the month's Key monthly drivers are confirmed, with no newer suggestion waiting;
--   4. no bank credit of the month is left to reconcile (Approvals > To reconcile);
--   5. every cash gift on the Donation Tracker for the month is posted under a confirmed name.
-- The CEO, finance or the Super Admin (power confirm_summary) closes it. From then on the month's
-- bank lines, cash gifts and summary note can't be changed -- by staff or by the syncs -- until
-- the Super Admin reopens it, giving a reason. The database copy job (postgres) is not stopped.

create table if not exists ops.month_closes (
  month text primary key check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  closed boolean not null default true,
  closed_by uuid references shared.staff (id),
  closed_at timestamptz,
  checklist jsonb,
  reopened_by uuid references shared.staff (id),
  reopened_at timestamptz,
  reopen_reason text check (reopen_reason is null or length(reopen_reason) between 5 and 300)
);
comment on table ops.month_closes is 'Monthly close (0117): a closed month''s bank lines, cash gifts and summary note are locked until the Super Admin reopens it.';
alter table ops.month_closes enable row level security;
drop policy if exists "finance viewers read closes" on ops.month_closes;
create policy "finance viewers read closes" on ops.month_closes for select to authenticated
  using ((select shared.module_viewable('finance', 'executive')));
grant select on ops.month_closes to authenticated;

-- ---- the checklist ----
create or replace function ops.month_close_checklist(p_month text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ops, shared, pg_temp
as $$
declare
  v_start date;
  v_next date;
  v_last date;
  v_confirm_from numeric;
  v_unconfirmed int;
  v_unreconciled int;
  v_unposted int;
  v_note record;
  v_drivers_ok boolean;
  v_statement_ok boolean;
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

  select max(t.posting_date) into v_last from ops.bank_transactions t where t.posting_date >= v_start and t.posting_date < v_next;
  v_statement_ok := v_last is not null and (v_last >= v_next - 3 or exists (select 1 from ops.bank_transactions t where t.posting_date >= v_next));
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
      jsonb_build_object('key', 'statement', 'label', 'Bank statement uploaded to the month''s end', 'done', v_statement_ok,
                         'detail', case when v_last is null then 'No statement lines yet' else 'Last line ' || to_char(v_last, 'Mon DD') end),
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
revoke all on function ops.month_close_checklist(text) from public, anon;
grant execute on function ops.month_close_checklist(text) to authenticated, service_role;

-- ---- close and reopen ----
create or replace function ops.close_month(p_month text)
returns void
language plpgsql
security definer
set search_path = ops, shared, pg_temp
as $$
declare
  v_check jsonb;
begin
  if not shared.has_power('confirm_summary') then
    raise exception 'Only the CEO, finance or the Super Admin closes a month' using errcode = '42501';
  end if;
  v_check := ops.month_close_checklist(p_month);
  if not (v_check ->> 'ready')::boolean then
    raise exception 'The month isn''t ready to close: %', (
      select string_agg(i ->> 'label', '; ') from jsonb_array_elements(v_check -> 'items') i where not (i ->> 'done')::boolean)
      using errcode = '23514';
  end if;
  insert into ops.month_closes (month, closed, closed_by, closed_at, checklist)
  values (p_month, true, auth.uid(), now(), v_check)
  on conflict (month) do update set closed = true, closed_by = auth.uid(), closed_at = now(), checklist = v_check;
end;
$$;
revoke all on function ops.close_month(text) from public, anon;
grant execute on function ops.close_month(text) to authenticated;

create or replace function ops.reopen_month(p_month text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ops, shared, pg_temp
as $$
begin
  if not shared.has_role('admin') then
    raise exception 'Only the Super Admin reopens a closed month' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Say why the month is reopened' using errcode = '23514';
  end if;
  update ops.month_closes set closed = false, reopened_by = auth.uid(), reopened_at = now(), reopen_reason = btrim(p_reason)
   where month = p_month and closed;
  if not found then
    raise exception 'That month is not closed';
  end if;
end;
$$;
revoke all on function ops.reopen_month(text, text) from public, anon;
grant execute on function ops.reopen_month(text, text) to authenticated;

-- ---- the lock ----
create or replace function ops.month_is_closed(p_day date)
returns boolean language sql stable security definer
set search_path = ops, pg_temp as $$
  select exists (select 1 from ops.month_closes c where c.closed and c.month = to_char(p_day, 'YYYY-MM'));
$$;
revoke all on function ops.month_is_closed(date) from public, anon;
grant execute on function ops.month_is_closed(date) to authenticated, service_role;

-- Staff sessions and the syncs (service role) are held to a closed month; the database copy job is not.
create or replace function ops.guard_closed_month()
returns trigger language plpgsql security definer
set search_path = ops, pg_temp as $$
declare
  v_day date;
  v_old date;
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'service_role') then
    return coalesce(new, old);
  end if;
  if tg_table_name = 'bank_transactions' then
    v_day := case when tg_op = 'DELETE' then null else new.posting_date end;
    v_old := case when tg_op = 'INSERT' then null else old.posting_date end;
  elsif tg_table_name = 'donations' then
    if coalesce(new.kind, old.kind) <> 'cash' then return coalesce(new, old); end if;
    v_day := case when tg_op = 'DELETE' then null else new.date end;
    v_old := case when tg_op = 'INSERT' then null else old.date end;
  else -- finance_month_notes
    v_day := case when tg_op = 'DELETE' then null else to_date(new.month || '-01', 'YYYY-MM-DD') end;
    v_old := case when tg_op = 'INSERT' then null else to_date(old.month || '-01', 'YYYY-MM-DD') end;
  end if;
  if (v_day is not null and ops.month_is_closed(v_day)) or (v_old is not null and ops.month_is_closed(v_old)) then
    raise exception '% is closed. Ask the Super Admin to reopen it first.', to_char(coalesce(v_day, v_old), 'FMMonth YYYY')
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;
revoke all on function ops.guard_closed_month() from public, anon, authenticated;

drop trigger if exists guard_closed_month on ops.bank_transactions;
create trigger guard_closed_month before insert or update or delete on ops.bank_transactions
  for each row execute function ops.guard_closed_month();
drop trigger if exists guard_closed_month on ops.donations;
create trigger guard_closed_month before insert or update or delete on ops.donations
  for each row execute function ops.guard_closed_month();
drop trigger if exists guard_closed_month on ops.finance_month_notes;
create trigger guard_closed_month before insert or update or delete on ops.finance_month_notes
  for each row execute function ops.guard_closed_month();

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'ops' and tablename = 'month_closes') then
    alter publication supabase_realtime add table ops.month_closes;
  end if;
end $$;
