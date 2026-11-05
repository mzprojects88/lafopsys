-- 0131: ride history from the LAF Programs sheet (decided 6 Nov 2026).
-- The month tabs record rides per day: L-N (LAF House to NCH) and N-L (NCH to LAF House), in people. Some of those rows
-- have a date but no child's name, and the sheet's own Report counts them, so a day's total is what is kept: it
-- matches the Report line for line. It shows as the "from sheet" Transportation figure. No trips are invented:
-- ops.trips stays what the drivers really record. The sync reads every tab once more after this ships.

create table if not exists ops.sheet_rides (
  date date primary key,
  to_nch integer not null default 0 check (to_nch >= 0),
  to_laf integer not null default 0 check (to_laf >= 0),
  synced_at timestamptz not null default now()
);
comment on table ops.sheet_rides is 'People riding per day, from the LAF Programs month tabs: L-N to NCH, N-L to LAF House (0131).';
alter table ops.sheet_rides enable row level security;
drop policy if exists "patients and house ops viewers read the sheet rides" on ops.sheet_rides;
create policy "patients and house ops viewers read the sheet rides" on ops.sheet_rides
  for select to authenticated using ((select shared.module_viewable('patients', 'house_ops', 'transport', 'reports')));
revoke all on ops.sheet_rides from anon, public;
revoke insert, update, delete on ops.sheet_rides from authenticated;
grant select on ops.sheet_rides to authenticated;

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
    select 'transport_to_nch', date_trunc(p_grain, sr.date)::date, sum(sr.to_nch)::numeric from ops.sheet_rides sr where sr.date between p_from and p_to group by 2
    union all
    select 'transport_to_laf', date_trunc(p_grain, sr.date)::date, sum(sr.to_laf)::numeric from ops.sheet_rides sr where sr.date between p_from and p_to group by 2
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

notify pgrst, 'reload schema';
