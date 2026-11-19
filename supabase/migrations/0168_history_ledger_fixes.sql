-- 0168: fixes to 0167 (Patients > History) found in review, 19 Nov 2026.
--   1. ops.program_impact_range_rows: 0167 looked up the "from sheet" column once per line and period (8.4 s
--      for a year by day, against 0.7 s before). It is totalled once and joined again, as before 0167.
--   2. ops.report_extra (occupancy in Reports): the House Sheet's names were left out of any night with an app
--      night, so a night partly entered in History would lose the rest. They are now left out only of nights
--      recorded live on House Today and of complete days; each child still counts once.
--   3. ops.history_edits: a Transport-only account reads the ride entries only (as History shows them), not
--      the nights, meals and their notes.

-- ---- 1 ----
create or replace function ops.program_impact_range_rows(p_from date, p_to date, p_grain text)
 returns table(line text, bucket date, native numeric, from_sheet numeric)
 language sql
 stable security definer
 set search_path to 'ops', 'inventory', 'pg_temp'
as $function$
  with months as (select generate_series(date_trunc(p_grain, p_from::timestamp), p_to::timestamp, ('1 ' || p_grain)::interval)::date as m),
  done as (select hd.day from ops.history_days hd where hd.day between p_from and p_to), -- 0167
  lines as (
    select unnest(array['housing', 'transport_to_nch', 'transport_to_laf', 'meals_breakfast', 'meals_lunch', 'meals_dinner',
                        'care_cart_1000', 'care_cart_1200', 'care_cart_1700', 'care_cart_volunteers',
                        'center_nch_participants', 'center_nch_hours', 'center_nch_volunteers', 'center_laf_volunteers', 'caf_nights']) as l
  ),
  native as (
    select 'housing' as l, date_trunc(p_grain, bn.night)::date as m, sum(1 + s.people_with_child)::numeric as v
      from ops.bed_nights bn join ops.stays s on s.id = bn.stay_id where bn.night between p_from and p_to group by 2
    union all
    select case t.direction when 'to_hospital' then 'transport_to_nch' else 'transport_to_laf' end, date_trunc(p_grain, t.date)::date, sum(tp.people)::numeric
      from ops.trips t join ops.trip_passengers tp on tp.trip_id = t.id
     where t.date between p_from and p_to and t.status <> 'cancelled' and t.direction in ('to_hospital', 'from_hospital') group by 1, 2
    union all
    select 'meals_' || ms.meal, date_trunc(p_grain, ms.date)::date, sum(1 + coalesce(st.people_with_child, 1))::numeric
      from ops.meals_served ms
      left join lateral (select people_with_child from ops.stays s where s.patient_id = ms.patient_id and s.check_in_at::date <= ms.date
                           and (s.check_out_at is null or s.check_out_at::date >= ms.date) order by s.check_in_at desc limit 1) st on true
     where ms.date between p_from and p_to group by 1, 2
    union all
    select 'care_cart_' || replace(c.time_slot, ':', ''), date_trunc(p_grain, c.date)::date, sum(coalesce(c.served_count, 0))::numeric
      from inventory.care_cart_runs c where c.sheet_key is null and c.delivery_status <> 'cancelled' and c.date between p_from and p_to and c.time_slot in ('10:00', '12:00', '17:00') group by 1, 2
    union all
    select 'care_cart_volunteers', date_trunc(p_grain, c.date)::date, sum(coalesce(c.volunteer_count, 0))::numeric
      from inventory.care_cart_runs c where c.sheet_key is null and c.delivery_status <> 'cancelled' and c.date between p_from and p_to group by 2
    union all
    select 'center_nch_participants', date_trunc(p_grain, a.date)::date, sum(a.participants)::numeric from ops.activity_sessions a where a.source = 'app' and a.site = 'NCH' and a.date between p_from and p_to group by 2
    union all
    select 'center_nch_hours', date_trunc(p_grain, a.date)::date, sum(a.hours)::numeric from ops.activity_sessions a where a.source = 'app' and a.site = 'NCH' and a.date between p_from and p_to group by 2
    union all
    select 'center_nch_volunteers', date_trunc(p_grain, a.date)::date, sum(a.volunteer_count)::numeric from ops.activity_sessions a where a.source = 'app' and a.site = 'NCH' and a.date between p_from and p_to group by 2
    union all
    select 'center_laf_volunteers', date_trunc(p_grain, a.date)::date, sum(a.volunteer_count)::numeric from ops.activity_sessions a where a.source = 'app' and a.site = 'LAF' and a.date between p_from and p_to group by 2
    union all
    select 'caf_nights', date_trunc(p_grain, bn.night)::date, count(*)::numeric
      from ops.bed_nights bn join ops.stays s on s.id = bn.stay_id join ops.patients p on p.id = s.patient_id
     where p.caf_billing and bn.night between p_from and p_to group by 2
  ),
  from_sheet as (
    select 'housing' as l, date_trunc(p_grain, sm.date)::date as m, sum(coalesce(sm.bn, 0))::numeric as v from ops.sheet_meals sm where sm.date between p_from and p_to and sm.date not in (select day from done) group by 2
    union all
    select 'transport_to_nch', date_trunc(p_grain, sr.date)::date, sum(sr.to_nch)::numeric from ops.sheet_rides sr where sr.date between p_from and p_to and sr.date not in (select day from done) group by 2
    union all
    select 'transport_to_laf', date_trunc(p_grain, sr.date)::date, sum(sr.to_laf)::numeric from ops.sheet_rides sr where sr.date between p_from and p_to and sr.date not in (select day from done) group by 2
    union all
    select 'meals_breakfast', date_trunc(p_grain, sm.date)::date, sum(sm.breakfast)::numeric from ops.sheet_meals sm where sm.date between p_from and p_to and sm.date not in (select day from done) group by 2
    union all
    select 'meals_lunch', date_trunc(p_grain, sm.date)::date, sum(sm.lunch)::numeric from ops.sheet_meals sm where sm.date between p_from and p_to and sm.date not in (select day from done) group by 2
    union all
    select 'meals_dinner', date_trunc(p_grain, sm.date)::date, sum(sm.dinner)::numeric from ops.sheet_meals sm where sm.date between p_from and p_to and sm.date not in (select day from done) group by 2
    union all
    select 'care_cart_' || replace(c.time_slot, ':', ''), date_trunc(p_grain, c.date)::date, sum(coalesce(c.served_count, 0))::numeric
      from inventory.care_cart_runs c where c.sheet_key is not null and c.delivery_status <> 'cancelled' and c.date between p_from and p_to and c.time_slot in ('10:00', '12:00', '17:00') group by 1, 2
    union all
    select 'care_cart_volunteers', date_trunc(p_grain, c.date)::date, sum(coalesce(c.volunteer_count, 0))::numeric
      from inventory.care_cart_runs c where c.sheet_key is not null and c.delivery_status <> 'cancelled' and c.date between p_from and p_to group by 2
    union all
    select 'center_nch_participants', date_trunc(p_grain, a.date)::date, sum(a.participants)::numeric from ops.activity_sessions a where a.source = 'sheet' and a.site = 'NCH' and a.date between p_from and p_to group by 2
    union all
    select 'center_nch_hours', date_trunc(p_grain, a.date)::date, sum(a.hours)::numeric from ops.activity_sessions a where a.source = 'sheet' and a.site = 'NCH' and a.date between p_from and p_to group by 2
    union all
    select 'center_nch_volunteers', date_trunc(p_grain, a.date)::date, sum(a.volunteer_count)::numeric from ops.activity_sessions a where a.source = 'sheet' and a.site = 'NCH' and a.date between p_from and p_to group by 2
    union all
    select 'center_laf_volunteers', date_trunc(p_grain, a.date)::date, sum(a.volunteer_count)::numeric from ops.activity_sessions a where a.source = 'sheet' and a.site = 'LAF' and a.date between p_from and p_to group by 2
    union all
    select 'caf_nights', date_trunc(p_grain, r.night)::date, count(*)::numeric
      from ops.nightly_record r join ops.patients p on p.id = r.patient_id
     where r.source = 'sheet' and p.caf_billing and r.night between p_from and p_to group by 2
    -- 0167: complete days, from the app (the same sums as the native column, on those days only)
    union all
    select 'housing', date_trunc(p_grain, bn.night)::date, sum(1 + s.people_with_child)::numeric
      from ops.bed_nights bn join ops.stays s on s.id = bn.stay_id where bn.night in (select day from done) group by 2
    union all
    select case t.direction when 'to_hospital' then 'transport_to_nch' else 'transport_to_laf' end, date_trunc(p_grain, t.date)::date, sum(tp.people)::numeric
      from ops.trips t join ops.trip_passengers tp on tp.trip_id = t.id
     where t.date in (select day from done) and t.direction in ('to_hospital', 'from_hospital') group by 1, 2
    union all
    select 'meals_' || ms.meal, date_trunc(p_grain, ms.date)::date, sum(1 + coalesce(st.people_with_child, 1))::numeric
      from ops.meals_served ms
      left join lateral (select people_with_child from ops.stays s where s.patient_id = ms.patient_id and s.check_in_at::date <= ms.date
                           and (s.check_out_at is null or s.check_out_at::date >= ms.date) order by s.check_in_at desc limit 1) st on true
     where ms.date in (select day from done) group by 1, 2
    union all
    select 'caf_nights', date_trunc(p_grain, bn.night)::date, count(*)::numeric
      from ops.bed_nights bn join ops.stays s on s.id = bn.stay_id join ops.patients p on p.id = s.patient_id
     where p.caf_billing and bn.night in (select day from done) group by 2
  ),
  from_sheet_sum as (select f.l, f.m, sum(f.v) as v from from_sheet f group by f.l, f.m), -- 0168: totalled once
  -- 0148: a past night the House Sheet lists that the Programs sheet (sheet_meals) has not: each child once
  -- (dismissed names left out), with their carer. 0167: only the children the app does not have that night
  -- (it was any app night at all), and never a complete day. Added to both columns below.
  fill as (
    select date_trunc(p_grain, x.night)::date as m, sum(x.people)::numeric as v from (
      select sn.night, max(1 + (nullif(btrim(sn.carer_name), '') is not null)::int) as people
        from ops.sheet_nights sn left join ops.house_sheet_people hp on hp.name_key = sn.name_key
       where sn.night between p_from and least(p_to, (now() at time zone 'Asia/Manila')::date - 1)
         and coalesce(hp.match_status, 'unmatched') <> 'dismissed'
         and not exists (select 1 from ops.sheet_meals sm where sm.date = sn.night)
         and sn.night not in (select day from done)
         and not exists (select 1 from ops.bed_nights b join ops.stays s on s.id = b.stay_id
                          where b.night = sn.night
                            and s.patient_id = case when hp.match_status in ('auto_matched', 'confirmed', 'encoded') then hp.matched_patient_id end)
       group by sn.night, coalesce(hp.matched_patient_id::text, sn.name_key)
    ) x group by 1
  )
  select lines.l, months.m,
         coalesce(n.v, 0) + case when lines.l = 'housing' then coalesce(fl.v, 0) else 0 end,
         coalesce(f.v, 0) + case when lines.l = 'housing' then coalesce(fl.v, 0) else 0 end
    from lines cross join months
    left join native n on n.l = lines.l and n.m = months.m
    left join from_sheet_sum f on f.l = lines.l and f.m = months.m
    left join fill fl on fl.m = months.m
   order by lines.l, months.m;
$function$;

-- ---- 2 ----
CREATE OR REPLACE FUNCTION ops.report_extra(p_from date, p_to date, p_fund text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'ops', 'pg_temp'
AS $function$
declare
  r jsonb;
  v_today date := (now() at time zone 'Asia/Manila')::date;
  -- The last night counted: today once its beds are finalized in the app, else yesterday.
  v_to date := least(p_to, case when exists (select 1 from ops.bed_nights where night = (now() at time zone 'Asia/Manila')::date) then (now() at time zone 'Asia/Manila')::date else (now() at time zone 'Asia/Manila')::date - 1 end);
  -- Spending and the budget run to today.
  v_spent_to date := least(p_to, (now() at time zone 'Asia/Manila')::date);
begin
  if not shared.module_viewable('reports') then
    raise exception 'Reports access is needed.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 3700 then
    raise exception 'Give a date range of up to ten years.' using errcode = '22023';
  end if;
  with nights as (
    select b.night, 'p:' || s.patient_id as k from ops.bed_nights b join ops.stays s on s.id = b.stay_id where b.night between p_from and v_to
    union
    select sn.night, coalesce('p:' || hp.matched_patient_id, 'n:' || sn.name_key)
      from ops.sheet_nights sn left join ops.house_sheet_people hp on hp.name_key = sn.name_key
     where sn.night between p_from and least(v_to, v_today - 1) and coalesce(hp.match_status, 'unmatched') <> 'dismissed'
       and not exists (select 1 from ops.bed_nights b join ops.stays s0 on s0.id = b.stay_id where b.night = sn.night and not s0.from_history) -- 0168
       and not exists (select 1 from ops.history_days hd where hd.day = sn.night)
  ), per_night as (select night, count(*) as families from nights group by night)
  select jsonb_build_object('occupancy', jsonb_build_object(
    'beds', (select coalesce(sum(capacity), 0) from ops.units where active),
    'regular_beds', (select coalesce(sum(capacity), 0) from ops.units where active and not temporary),
    'days', greatest(v_to - p_from + 1, 0),
    'family_nights', coalesce((select sum(families) from per_night), 0),
    'busiest', (select jsonb_build_object('night', night, 'families', families) from per_night order by families desc, night desc limit 1),
    'empty_nights', greatest(v_to - p_from + 1, 0) - (select count(*) from per_night)
  )) into r;

  if shared.dashboard_card_ok('expenses') then
    r := r || jsonb_build_object('expenses', (
      with paid as (
        select v.id from ops.vouchers v
         where v.status = 'released' and v.kind not in ('fund_topup', 'cash_advance')
           and (v.released_at at time zone 'Asia/Manila')::date between p_from and p_to
           and (p_fund is null or exists (select 1 from ops.fin_codes f where f.id = v.t2_id and f.code = p_fund))
      ), lines as (
        select v.t2_id, l.account_id, coalesce(l.legacy_code, '') as legacy_code, coalesce(l.legacy_account_name, '') as legacy_name, l.amount
          from paid p join ops.vouchers v on v.id = p.id join ops.voucher_lines l on l.voucher_id = p.id
      ), months as (
        -- Each month the range touches, with the share of its days in the range.
        select m::date as month, (least(v_spent_to, (m + interval '1 month - 1 day')::date) - greatest(p_from, m::date) + 1)::numeric
                 / extract(day from (m + interval '1 month - 1 day'))::numeric as share
          from generate_series(date_trunc('month', p_from::timestamp), v_spent_to::timestamp, interval '1 month') m
         where v_spent_to >= p_from
      ), budget as (
        select sum(bv.amount * mo.share) as amount
          from months mo
          join ops.budgets b on b.year = extract(year from mo.month)::int and b.status = 'approved'
           and b.version = (select max(b2.version) from ops.budgets b2 where b2.year = b.year and b2.status = 'approved')
          join ops.budget_items bi on bi.budget_id = b.id
          join ops.budget_values bv on bv.item_id = bi.id and bv.month = extract(month from mo.month)::int
         where p_fund is null
      )
      select jsonb_build_object(
        'total', coalesce((select sum(amount) from lines), 0),
        'vouchers', (select count(*) from paid),
        -- The whole foundation's approved budget for these days (none when one fund is asked for: budgets aren't by fund).
        'budget', case when shared.dashboard_card_ok('budget') then (select round(amount, 2) from budget) end,
        'by_account', coalesce((select jsonb_agg(x order by x.amount desc) from (
            select coalesce(a.code, nullif(l.legacy_code, ''), '—') as code, coalesce(a.name, nullif(l.legacy_name, ''), 'Not coded') as name, sum(l.amount) as amount
              from lines l left join ops.coa_accounts a on a.id = l.account_id group by 1, 2) x), '[]'::jsonb),
        'by_fund', coalesce((select jsonb_agg(x order by x.amount desc) from (
            select coalesce(f.code, '—') as code, coalesce(f.name, 'No fund') as name, sum(l.amount) as amount
              from lines l left join ops.fin_codes f on f.id = l.t2_id group by 1, 2) x), '[]'::jsonb)
      )));
  end if;
  return r;
end $function$;

-- ---- 3 ----
drop policy if exists "patients and transport viewers read the history trail" on ops.history_edits;
create policy "patients viewers read the history trail, transport viewers its rides" on ops.history_edits for select to authenticated
  using ((select shared.module_viewable('patients')) or ((select shared.module_viewable('transport')) and action like 'ride%'));
