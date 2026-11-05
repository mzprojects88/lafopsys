-- 0128: the Programs report for any range (Nov 2026): a day, a week, a month, a quarter, a year or
-- two dates, broken into days, weeks (Monday) or months. ops.program_impact_range_rows is 0112's
-- program_impact_rows with the year replaced by a range and the month by a date_trunc bucket; the
-- yearly functions the scheduled email uses are kept and now read through it.

create or replace function ops.program_impact_range_rows(p_from date, p_to date, p_grain text)
returns table (line text, bucket date, native numeric, from_sheet numeric)
language sql stable security definer
set search_path to 'ops', 'inventory', 'pg_temp' as $$
  with months as (select generate_series(date_trunc(p_grain, p_from::timestamp), p_to::timestamp, ('1 ' || p_grain)::interval)::date as m),
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
    select 'housing' as l, date_trunc(p_grain, sm.date)::date as m, sum(coalesce(sm.bn, 0))::numeric as v from ops.sheet_meals sm where sm.date between p_from and p_to group by 2
    union all
    select 'meals_breakfast', date_trunc(p_grain, sm.date)::date, sum(sm.breakfast)::numeric from ops.sheet_meals sm where sm.date between p_from and p_to group by 2
    union all
    select 'meals_lunch', date_trunc(p_grain, sm.date)::date, sum(sm.lunch)::numeric from ops.sheet_meals sm where sm.date between p_from and p_to group by 2
    union all
    select 'meals_dinner', date_trunc(p_grain, sm.date)::date, sum(sm.dinner)::numeric from ops.sheet_meals sm where sm.date between p_from and p_to group by 2
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
  )
  select lines.l, months.m, coalesce(n.v, 0), coalesce(f.v, 0)
    from lines cross join months
    left join native n on n.l = lines.l and n.m = months.m
    left join from_sheet f on f.l = lines.l and f.m = months.m
   order by lines.l, months.m;
$$;
revoke all on function ops.program_impact_range_rows(date, date, text) from public, anon, authenticated;

-- The yearly rows, as before, through the range function (the month is the bucket's month).
create or replace function ops.program_impact_rows(p_year integer)
returns table (line text, month integer, native numeric, from_sheet numeric)
language sql stable security definer
set search_path to 'ops', 'pg_temp' as $$
  select r.line, extract(month from r.bucket)::int, r.native, r.from_sheet
    from ops.program_impact_range_rows(make_date(p_year, 1, 1), make_date(p_year, 12, 31), 'month') r
   order by r.line, r.bucket;
$$;
revoke all on function ops.program_impact_rows(integer) from public, anon, authenticated;

-- The page's door for a range: anyone who may read Reports; at most three years, one of three grains.
create or replace function ops.program_impact_range(p_from date, p_to date, p_grain text)
returns table (line text, bucket date, native numeric, from_sheet numeric)
language plpgsql stable security definer
set search_path to 'ops', 'pg_temp' as $$
begin
  if not shared.module_viewable('reports') then
    raise exception 'Reports access is needed to see the Programs report' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 1100 then
    raise exception 'Give a range of up to three years' using errcode = '22023';
  end if;
  if p_grain not in ('day', 'week', 'month') then
    raise exception 'Grain must be day, week or month' using errcode = '22023';
  end if;
  return query select r.line, r.bucket, r.native, r.from_sheet from ops.program_impact_range_rows(p_from, p_to, p_grain) r;
end;
$$;
revoke all on function ops.program_impact_range(date, date, text) from public, anon;
grant execute on function ops.program_impact_range(date, date, text) to authenticated;

-- The generator page (Reports > Generate) for every role that reads the Reports catalogue.
insert into shared.role_page_access (role, page, level)
select r.role, p.page, r.level
  from shared.role_page_access r cross join (values ('reports.generate')) p(page)
 where r.page = 'reports.catalogue'
on conflict do nothing;

notify pgrst, 'reload schema';
