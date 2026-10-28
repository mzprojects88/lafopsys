-- 0121: the Executive summary's months before their bank statement, and a nightly drivers note.
--
-- Until 0121 a month existed on the summary only once its bank statement was in, so August to
-- October 2026 (statement lines end 31 Jul) showed nothing. The Donation Tracker's BDO deposits
-- match the bank's Donation figure to within 0.1% for every month January-July 2026 (3,612,555 vs
-- 3,615,022), so a month without a statement now shows Donation from those deposits, marked
-- provisional; Expenses wait for the statement (no other record of spending exists).
--
--  1. ops.month_driver_facts(month, through): `through` cuts the facts at the end of a day (the
--     nightly note runs at 1:00 AM on the day before's data). Without bank lines the totals come
--     from ops.cash_deposits with expenses null and provisional = true.
--  2. ops.confirm_month_drivers refuses a month that is not complete: the month has ended and its
--     statement reaches the month's last banking days (or a later month is in). Until then the
--     note stays a draft; the statement's import drafts a new one (draftAfterImport).
--  3. ops.cash_deposits streams to the page (the summary's provisional Donation is live).
--  4. pg_cron 'month-drivers-nightly' at 1:00 AM Manila (production only).

-- ---- 1. the month's facts, with a cut-off and the tracker fallback ----
drop function if exists ops.month_driver_facts(text);

create or replace function ops.month_driver_facts(p_month text, p_through date default null)
returns jsonb
language plpgsql stable security definer
set search_path to 'ops', 'hr', 'shared', 'pg_temp'
as $function$
declare
  v_start date;
  v_end date;   -- the first day after the month
  v_next date;  -- the first day after the facts (v_end, or the day after p_through)
  v_name_from numeric;
  v_today date := (now() at time zone 'Asia/Manila')::date;
begin
  if not (shared.has_power('confirm_summary') or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'Only the CEO, finance or the Super Admin reads the month''s facts' using errcode = '42501';
  end if;
  if p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Month must be yyyy-MM';
  end if;
  v_start := to_date(p_month || '-01', 'YYYY-MM-DD');
  v_end := (v_start + interval '1 month')::date;
  v_next := v_end;
  if p_through is not null and p_through + 1 < v_end then
    v_next := greatest(p_through + 1, v_start);
  end if;
  select coalesce((exec_summary ->> 'name_from')::numeric, 20000) into v_name_from from shared.app_settings where id;

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
    ),
    prior6 as (
      select round(avg(donation)) as donation, round(avg(expenses)) as expenses, max(donation) filter (where left(ym, 4) = left(p_month, 4)) as best_this_year,
             count(*) filter (where left(ym, 4) = left(p_month, 4)) as months_this_year
      from tot where ym < p_month and ym >= to_char(v_start - interval '6 months', 'YYYY-MM')
    ),
    -- Complete: the month has ended and its statement reaches the last banking days (or a later month is in).
    complete as (
      select v_end <= v_today
             and (exists (select 1 from ops.bank_transactions l where l.posting_date >= v_end - 3 and l.posting_date < v_end)
                  or exists (select 1 from ops.bank_transactions l where l.posting_date >= v_end)) as ok
    ),
    -- Before the statement: the BDO deposits the Donation Tracker lists (0110) stand in for the bank's Donation.
    deposits as (
      select round(sum(c.amount), 2) as amount, count(*)::int as n, max(c.deposit_date) as last_date
      from ops.cash_deposits c where c.deposit_date >= v_start and c.deposit_date < v_next
    ),
    gifts as (
      select dn.type, sum(d.total_value) as amount, count(*)::int as gifts, d.kind = 'cash' as cash,
             case when dn.type in ('corporate', 'foundation', 'government') or sum(d.total_value) >= v_name_from then dn.name
                  when dn.type = 'anonymous' then 'an anonymous donor'
                  else 'an individual donor' end as name
      from ops.donations d left join ops.donors dn on dn.id = d.donor_id
      where d.date >= v_start and d.date < v_next
      group by dn.id, dn.type, dn.name, d.kind = 'cash'
    ),
    debits as (
      select t.* from ops.bank_transactions t where t.posting_date >= v_start and t.posting_date < v_next and t.debit > 0
    )
    select jsonb_build_object(
      'month', p_month,
      'data_through', v_next - 1,
      'month_to_date', v_next < v_end or v_end > v_today,
      'totals', coalesce(
        (select jsonb_build_object(
                   'expenses', expenses, 'donation', donation, 'net', donation - expenses,
                   'pct_of_donation_spent', case when donation > 0 then round(expenses / donation * 100, 1) end,
                   'statement_through', last_line,
                   'covers_full_month', (select ok from complete),
                   'provisional', not (select ok from complete),
                   'source', 'bank statement')
         from tot where ym = p_month),
        (select jsonb_build_object(
                   'donation', amount, 'expenses', null,
                   'source', 'Donation Tracker deposits; the bank statement is not in yet, so expenses are not known',
                   'deposits', n, 'deposits_through', last_date,
                   'covers_full_month', false, 'provisional', true)
         from deposits where n > 0)),
      'previous_month', (select jsonb_build_object('expenses', expenses, 'donation', donation)
                         from tot where ym = to_char(v_start - interval '1 month', 'YYYY-MM')),
      'same_month_last_year', (select jsonb_build_object('expenses', expenses, 'donation', donation)
                               from tot where ym = to_char(v_start - interval '1 year', 'YYYY-MM')),
      'six_month_average', (select jsonb_build_object('donation', donation, 'expenses', expenses) from prior6 where donation is not null),
      'record_high_donation_this_year', (select t.donation > p.best_this_year from tot t, prior6 p where t.ym = p_month and p.months_this_year >= 3),
      'cash_in_bank_month_end', (select t.running_balance from ops.bank_transactions t
                                 where t.posting_date >= v_start and t.posting_date < v_next
                                 order by t.posting_date desc, t.row_seq desc limit 1),
      'largest_credits', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
          select t.posting_date as date, t.credit as amount,
                 case when dn.id is null then case when t.deposit_id is not null then 'a tracker deposit' end
                      when dn.type in ('corporate', 'foundation', 'government') or t.credit >= v_name_from then dn.name
                      else 'an individual donor' end as donor
          from ops.bank_transactions t
          left join ops.donations d on d.id = t.donation_id
          left join ops.donors dn on dn.id = d.donor_id
          where t.posting_date >= v_start and t.posting_date < v_next and t.credit > 0 and t.category is distinct from 'interest'
          order by t.credit desc limit 5) x),
      'cash_gifts_by_donor', (select coalesce(jsonb_agg(jsonb_build_object('donor', name, 'type', type, 'amount', amount, 'gifts', gifts) order by amount desc), '[]'::jsonb)
                              from (select * from gifts where cash order by amount desc limit 6) g),
      'cash_gifts_total', (select jsonb_build_object('gifts', coalesce(sum(gifts), 0), 'amount', coalesce(sum(amount), 0), 'donors', count(*)) from gifts where cash),
      'in_kind', (select jsonb_build_object('gifts', coalesce(sum(gifts), 0), 'value', coalesce(sum(amount), 0),
                    'top_donors', (select coalesce(jsonb_agg(jsonb_build_object('donor', name, 'value', amount) order by amount desc), '[]'::jsonb)
                                   from (select * from gifts where not cash order by amount desc limit 3) k))
                  from gifts where not cash),
      'expenses_by_purpose', (select coalesce(jsonb_agg(jsonb_build_object('purpose', purpose, 'amount', amount, 'lines', n, 'confirmed', confirmed) order by amount desc), '[]'::jsonb)
                              from (select coalesce(purpose, 'not yet tagged') as purpose, sum(debit) as amount, count(*)::int as n, bool_and(purpose_confirmed) as confirmed
                                    from debits group by 1) p),
      'advances_settled', (select coalesce(jsonb_agg(jsonb_build_object('advanced_in', settles_month, 'amount', amount)), '[]'::jsonb)
                           from (select settles_month, sum(debit) as amount from debits where settles_month is not null group by 1) a),
      'largest_debits', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
          select d.posting_date as date, d.debit as amount, left(d.description, 48) as bank_text, d.purpose, d.settles_month as advanced_in
          from debits d order by d.debit desc limit 6) x),
      'payroll_paid', (select jsonb_build_object('payslips', count(*), 'net_total', coalesce(sum(p.net), 0))
                       from hr.payslips p where p.pay_date >= v_start and p.pay_date < v_next),
      'staff_changes', (select jsonb_build_object('hired', count(*) filter (where e.kind = 'hired'), 'separated', count(*) filter (where e.kind = 'separated'))
                        from hr.employment_events e where e.effective_on >= v_start and e.effective_on < v_next),
      'vehicle_costs', (select coalesce(jsonb_object_agg(k.name, k.amt), '{}'::jsonb) from (
          select coalesce(vk.name, v.kind) as name, sum(v.amount) as amt
          from ops.vehicle_expenses v left join ops.vehicle_expense_kinds vk on vk.id = v.kind
          where v.voided_at is null and v.expense_date >= v_start and v.expense_date < v_next
          group by 1) k),
      'new_families_admitted', (select count(*) from ops.stays s where s.visit_id = s.id and s.check_in_at >= v_start and s.check_in_at < v_next),
      -- The Programs report counts by month; a month-to-date note reads it as it stands.
      'house_activity', (select coalesce(jsonb_object_agg(l.label, l.n), '{}'::jsonb) from (
          select case when r.line = 'housing' then 'people_nights_housed'
                      when r.line like 'meals_%' then 'meals_served'
                      when r.line like 'transport_%' then 'one_way_rides_to_and_from_hospital'
                      when r.line in ('care_cart_1000', 'care_cart_1200', 'care_cart_1700') then 'care_cart_servings_at_the_hospital'
                      else 'learning_center_participants' end as label,
                 sum(greatest(r.native, r.from_sheet)) as n
          from ops.program_impact_rows(extract(year from v_start)::int) r
          where r.month = extract(month from v_start)::int
            and r.line in ('housing', 'meals_breakfast', 'meals_lunch', 'meals_dinner', 'transport_to_nch', 'transport_to_laf',
                           'care_cart_1000', 'care_cart_1200', 'care_cart_1700', 'center_nch_participants')
          group by 1) l),
      'events', (select jsonb_build_object(
                   'total', count(*), 'at_laf_house', count(*) filter (where c.venue ilike '%laf%'),
                   'birthday_celebrations', count(*) filter (where c.title ~* 'birthday|bday'),
                   'donor_visits_and_meal_sponsors', count(*) filter (where c.title ~* 'donor|visit|lunch|dinner|breakfast|snack|meal|feeding'),
                   'partner_meetings_and_signings', count(*) filter (where c.title ~* 'signing|meeting|partner|\mmoa\M|\mmou\M'),
                   'outreach_and_classes', count(*) filter (where c.title ~* 'outreach|mission|class|workshop|seminar|activity'))
                 from ops.calendar_events c
                 where c.date >= v_start and c.date < v_next and c.sheet_removed_at is null and not c.is_holiday)
    )
  );
end;
$function$;

revoke all on function ops.month_driver_facts(text, date) from public, anon;
grant execute on function ops.month_driver_facts(text, date) to authenticated, service_role;

-- ---- 2. a note is confirmed only once its month is complete ----
create or replace function ops.confirm_month_drivers(p_month text, p_text text)
returns void
language plpgsql security definer
set search_path to 'ops', 'shared', 'pg_temp'
as $function$
declare
  v_end date;
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
  v_end := (to_date(p_month || '-01', 'YYYY-MM-DD') + interval '1 month')::date;
  if v_end > (now() at time zone 'Asia/Manila')::date
     or not (exists (select 1 from ops.bank_transactions l where l.posting_date >= v_end - 3 and l.posting_date < v_end)
             or exists (select 1 from ops.bank_transactions l where l.posting_date >= v_end)) then
    raise exception 'This month stays a draft until it has ended and its bank statement is in; the statement''s import drafts a new note' using errcode = '23514';
  end if;
  insert into ops.finance_month_notes (month, drivers, updated_by, updated_at, confirmed_by, confirmed_at)
  values (p_month, btrim(p_text), auth.uid(), now(), auth.uid(), now())
  on conflict (month) do update
    set drivers = excluded.drivers, updated_by = excluded.updated_by, updated_at = now(),
        confirmed_by = excluded.confirmed_by, confirmed_at = now();
end;
$function$;

-- ---- 3. deposits stream to the summary ----
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'ops' and tablename = 'cash_deposits') then
    alter publication supabase_realtime add table ops.cash_deposits;
  end if;
end $$;

-- ---- 4. the nightly note: 1:00 AM Manila, on the day before's data (production only) ----
do $$
begin
  if exists (select 1 from cron.job where jobname = 'house-sheet-sync') and not exists (select 1 from cron.job where jobname = 'month-drivers-nightly') then
    perform cron.schedule(
      'month-drivers-nightly',
      '0 17 * * *', -- 1:00 AM Manila
      $job$
      select net.http_post(
        url := 'https://lafopsys.vercel.app/api/finance/month-drivers',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'calendar_sync_secret' limit 1)
        ),
        body := '{"trigger":"cron"}'::jsonb,
        timeout_milliseconds := 300000
      );
      $job$
    );
  end if;
end $$;

notify pgrst, 'reload schema';
