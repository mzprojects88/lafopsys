-- 0114: the Key monthly drivers become the month's analysis, in the shape the CEO's own notes had.
--
-- The notes for January to July say two things: how donations went and who drove them (named
-- companies, foundations, NCH, large personal gifts), and what the money was spent on (payroll,
-- utilities, permits, construction...) including costs advanced one month and settled the next.
-- The bank only says "ONLINE TRANSFER", and the founder's reimbursements sheet that explained it
-- is no longer kept (user, 27 Oct). So from here each bank debit carries its purpose: the app
-- suggests it, finance confirms the large ones on Bank import. The facts the model reads grow
-- to the month's gifts by donor, in-kind gifts, purposes, advances settled, staff changes, new
-- families, events and the house's activity. Names follow one rule, set in Settings: companies,
-- foundations and government always; a person only from a set amount. Children's and staff
-- names never leave the database.

-- ---- 1. what each debit was for ----
alter table ops.bank_transactions
  add column if not exists purpose text check (purpose is null or length(purpose) between 1 and 60),
  add column if not exists purpose_confirmed boolean not null default false,
  add column if not exists settles_month text check (settles_month is null or settles_month ~ '^\d{4}-(0[1-9]|1[0-2])$');
comment on column ops.bank_transactions.purpose is 'What a debit paid for, from the list in Settings > Executive summary (0114). Suggested by the app until purpose_confirmed.';
comment on column ops.bank_transactions.settles_month is 'For a reimbursement of advances: the month the costs were advanced (0114).';

-- ---- 2. the figures, in Settings ----
alter table shared.app_settings add column if not exists exec_summary jsonb not null default jsonb_build_object(
  'purposes', jsonb_build_array('Payroll', 'Utilities', 'Rent', 'Permits and fees', 'Construction and repairs', 'Furniture and equipment',
                                'Food and groceries', 'Transport and fuel', 'Patient support', 'Software and subscriptions', 'Supplies',
                                'Reimbursement of advances', 'Bank charges', 'Transfer between accounts', 'Other'),
  'confirm_from', 10000,
  'name_from', 20000);
comment on column shared.app_settings.exec_summary is 'Executive summary (0114): purposes = the list a debit''s purpose comes from; confirm_from = debits from this amount wait for finance to confirm the suggested purpose; name_from = a person is named in the note from this gift total in the month (companies, foundations and government always are).';

-- ---- 3. the note is for finance and the executive ----
drop policy if exists "staff read month notes" on ops.finance_month_notes;
drop policy if exists "finance and executive read month notes" on ops.finance_month_notes;
create policy "finance and executive read month notes" on ops.finance_month_notes for select to authenticated
  using ((select shared.module_viewable('finance', 'executive')));

-- ---- 4. the month's facts ----
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
  v_name_from numeric;
begin
  if not (shared.has_power('confirm_summary') or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'Only the CEO, finance or the Super Admin reads the month''s facts' using errcode = '42501';
  end if;
  if p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Month must be yyyy-MM';
  end if;
  v_start := to_date(p_month || '-01', 'YYYY-MM-DD');
  v_next := (v_start + interval '1 month')::date;
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
    -- Who gave, by the naming rule: organisations always, a person from name_from in the month.
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
      'totals', (select jsonb_build_object(
                   'expenses', expenses, 'donation', donation, 'net', donation - expenses,
                   'pct_of_donation_spent', case when donation > 0 then round(expenses / donation * 100, 1) end,
                   'statement_through', last_line,
                   -- Complete when the lines reach the month's last banking days, or a later month is already in.
                   'covers_full_month', last_line >= v_next - 3 or exists (select 1 from ops.bank_transactions l where l.posting_date >= v_next))
                 from tot where ym = p_month),
      'previous_month', (select jsonb_build_object('expenses', expenses, 'donation', donation)
                         from tot where ym = to_char(v_start - interval '1 month', 'YYYY-MM')),
      'same_month_last_year', (select jsonb_build_object('expenses', expenses, 'donation', donation)
                               from tot where ym = to_char(v_start - interval '1 year', 'YYYY-MM')),
      'six_month_average', (select jsonb_build_object('donation', donation, 'expenses', expenses) from prior6 where donation is not null),
      'record_high_donation_this_year', (select t.donation > p.best_this_year from tot t, prior6 p where t.ym = p_month and p.months_this_year >= 3),
      'cash_in_bank_month_end', (select t.running_balance from ops.bank_transactions t
                                 where t.posting_date >= v_start and t.posting_date < v_next
                                 order by t.posting_date desc, t.row_seq desc limit 1),
      -- The largest credits as the bank saw them, with the donor when the credit is a posted gift (same naming rule).
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
      -- The Programs report's lines for the month, named by what they count.
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
      -- Calendar events counted by kind; titles stay in the database (they can name a child).
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
$$;
revoke all on function ops.month_driver_facts(text) from public, anon;
grant execute on function ops.month_driver_facts(text) to authenticated, service_role;
