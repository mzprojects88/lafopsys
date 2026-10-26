-- 0113: the Executive summary's "Key monthly drivers", drafted by the app and confirmed by a person.
--
-- Until now the paragraph beside each month's figures was typed by finance. From here the app
-- drafts it from the month's own records (bank lines, posted gifts by donor type, payroll,
-- vehicle costs, the house's activity) and a confirmer -- the CEO, finance, or the Super Admin --
-- approves it, edited or not. Only the confirmed text is what everyone else reads; `drivers`
-- keeps that meaning, so every reader of the table works unchanged.

-- ---- 1. the draft and the sign-off ----
alter table ops.finance_month_notes
  add column if not exists draft text,
  add column if not exists draft_at timestamptz,
  add column if not exists confirmed_by uuid references shared.staff (id),
  add column if not exists confirmed_at timestamptz;
comment on column ops.finance_month_notes.draft is 'The app''s latest suggestion for Key monthly drivers (0113); shown to confirmers only until confirmed into drivers.';
comment on column ops.finance_month_notes.confirmed_at is 'When a confirmer approved the text in drivers; a draft newer than this is a pending suggestion.';

-- The paragraphs typed before 0113 were read and accepted by the CEO month after month: confirmed, by nobody in particular.
update ops.finance_month_notes set confirmed_at = updated_at where drivers <> '' and confirmed_at is null;

-- ---- 2. the power ----
alter table shared.role_powers drop constraint if exists role_powers_power_check;
alter table shared.role_powers add constraint role_powers_power_check
  check (power in ('runs_hr', 'finance_work', 'bed_exception', 'floor_plan_layout', 'driver', 'clinical_detail', 'caf_billing', 'caf_billing_view', 'confirm_summary'));
insert into shared.role_powers (role, power) values
  ('ceo', 'confirm_summary'), ('finance', 'confirm_summary'), ('office_admin', 'confirm_summary')
on conflict do nothing;

-- ---- 3. the month's facts, for the model ----
-- Amounts and the bank's own line text only: no donor, patient or staff name leaves the database.
create or replace function ops.month_driver_facts(p_month text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ops, hr, shared, pg_temp
as $$
declare
  v_start date;
  v_next date;
begin
  if not (shared.has_power('confirm_summary') or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'Only the CEO, finance or the Super Admin reads the month''s facts' using errcode = '42501';
  end if;
  if p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Month must be yyyy-MM';
  end if;
  v_start := to_date(p_month || '-01', 'YYYY-MM-DD');
  v_next := (v_start + interval '1 month')::date;

  return (
    with tot as (
      select to_char(t.posting_date, 'YYYY-MM') as ym,
             round(sum(t.debit), 2) as expenses,
             round(sum(case when t.category is distinct from 'interest' then t.credit else 0 end), 2) as donation,
             count(*)::int as lines,
             max(t.posting_date) as last_line
      from ops.bank_transactions t
      where t.posting_date >= (v_start - interval '1 year')::date and t.posting_date < v_next
      group by 1
    )
    select jsonb_build_object(
      'month', p_month,
      'totals', (select jsonb_build_object(
                   'expenses', expenses, 'donation', donation, 'net', donation - expenses,
                   'pct_of_donation_spent', case when donation > 0 then round(expenses / donation * 100, 1) end,
                   'statement_lines', lines, 'statement_through', last_line,
                   -- Complete when the lines reach the month's last banking days, or a later month is already in.
                   'covers_full_month', last_line >= v_next - 3 or exists (select 1 from ops.bank_transactions l where l.posting_date >= v_next))
                 from tot where ym = p_month),
      'previous_month', (select jsonb_build_object('expenses', expenses, 'donation', donation)
                         from tot where ym = to_char(v_start - interval '1 month', 'YYYY-MM')),
      'same_month_last_year', (select jsonb_build_object('expenses', expenses, 'donation', donation)
                               from tot where ym = to_char(v_start - interval '1 year', 'YYYY-MM')),
      'cash_in_bank_month_end', (select t.running_balance from ops.bank_transactions t
                                 where t.posting_date >= v_start and t.posting_date < v_next
                                 order by t.posting_date desc, t.row_seq desc limit 1),
      'largest_credits', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
          select t.posting_date as date, t.credit as amount, left(t.description, 48) as bank_text, t.category,
                 case when t.donation_id is not null then 'posted gift' when t.deposit_id is not null then 'tracker deposit' end as linked
          from ops.bank_transactions t
          where t.posting_date >= v_start and t.posting_date < v_next and t.credit > 0
          order by t.credit desc limit 6) x),
      'largest_debits', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
          select t.posting_date as date, t.debit as amount, left(t.description, 48) as bank_text, t.category,
                 t.check_number is not null as by_check
          from ops.bank_transactions t
          where t.posting_date >= v_start and t.posting_date < v_next and t.debit > 0
          order by t.debit desc limit 6) x),
      'cash_gifts_posted', (select jsonb_build_object(
                   'count', count(*), 'total', coalesce(sum(d.total_value), 0), 'largest', max(d.total_value),
                   'by_donor_type', (select coalesce(jsonb_object_agg(k.type, k.n), '{}'::jsonb) from (
                        select coalesce(dn.type, 'unknown') as type, count(*)::int as n
                        from ops.donations d2 left join ops.donors dn on dn.id = d2.donor_id
                        where d2.kind = 'cash' and d2.date >= v_start and d2.date < v_next
                        group by 1) k))
                 from ops.donations d where d.kind = 'cash' and d.date >= v_start and d.date < v_next),
      'payroll_paid', (select jsonb_build_object('payslips', count(*), 'net_total', coalesce(sum(p.net), 0))
                       from hr.payslips p where p.pay_date >= v_start and p.pay_date < v_next),
      'vehicle_costs', (select coalesce(jsonb_object_agg(k.name, k.amt), '{}'::jsonb) from (
          select coalesce(vk.name, v.kind) as name, sum(v.amount) as amt
          from ops.vehicle_expenses v left join ops.vehicle_expense_kinds vk on vk.id = v.kind
          where v.voided_at is null and v.expense_date >= v_start and v.expense_date < v_next
          group by 1) k),
      'house_activity', (select coalesce(jsonb_object_agg(r.line, greatest(r.native, r.from_sheet)), '{}'::jsonb)
                         from ops.program_impact_rows(extract(year from v_start)::int) r
                         where r.month = extract(month from v_start)::int
                           and r.line in ('housing', 'meals_breakfast', 'meals_lunch', 'meals_dinner', 'transport_to_nch', 'transport_to_laf',
                                          'care_cart_1000', 'care_cart_1200', 'care_cart_1700', 'center_nch_participants'))
    )
  );
end;
$$;
revoke all on function ops.month_driver_facts(text) from public, anon;
grant execute on function ops.month_driver_facts(text) to authenticated, service_role;

-- ---- 4. the sign-off ----
-- One door for confirming (and for a confirmer's own wording): the text, who, when.
create or replace function ops.confirm_month_drivers(p_month text, p_text text)
returns void
language plpgsql
security definer
set search_path = ops, shared, pg_temp
as $$
begin
  if not shared.has_power('confirm_summary') then
    raise exception 'Only the CEO, finance or the Super Admin confirms the summary' using errcode = '42501';
  end if;
  if p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Month must be yyyy-MM';
  end if;
  if btrim(coalesce(p_text, '')) = '' then
    raise exception 'The summary is empty';
  end if;
  insert into ops.finance_month_notes (month, drivers, updated_by, updated_at, confirmed_by, confirmed_at)
  values (p_month, btrim(p_text), auth.uid(), now(), auth.uid(), now())
  on conflict (month) do update
    set drivers = excluded.drivers, updated_by = excluded.updated_by, updated_at = now(),
        confirmed_by = excluded.confirmed_by, confirmed_at = now();
end;
$$;
revoke all on function ops.confirm_month_drivers(text, text) from public, anon;
grant execute on function ops.confirm_month_drivers(text, text) to authenticated;
