-- 0148 House Sheet nights fill the gaps (user, 12 Nov 2026).
--
-- Housing came from the nights finalized in the app or, before that, the Programs sheet's BN column. On a night
-- nobody finalized that the Programs sheet doesn't have yet, it read 0 although the House Sheet listed who stayed
-- (18 on 11 Nov). Now such a night is counted from the House Sheet (each row a child and their carer), as a sheet
-- figure. The goal stays every night finalized in the app: ops.unfinalized_nights lists the nights the House Sheet
-- had to fill, for the social worker's reminder, and the dashboard says how many it used.

CREATE OR REPLACE FUNCTION ops.program_impact_range_rows(p_from date, p_to date, p_grain text)
 RETURNS TABLE(line text, bucket date, native numeric, from_sheet numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'ops', 'inventory', 'pg_temp'
AS $function$
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
    -- A day's bed nights from the Programs sheet (BN), or, for a day it doesn't have, from the House Sheet: each row
    -- a child and their carer (0148, user 12 Nov 2026: fill the gaps until every night is finalized in the app).
    select 'housing' as l, date_trunc(p_grain, x.d)::date as m, sum(x.v)::numeric as v from (
      select sm.date as d, coalesce(sm.bn, 0) as v from ops.sheet_meals sm where sm.date between p_from and p_to
      union all
      select sn.night, 1 + (nullif(btrim(sn.carer_name), '') is not null)::int from ops.sheet_nights sn
       where sn.night between p_from and p_to and not exists (select 1 from ops.sheet_meals sm where sm.date = sn.night)
    ) x group by 2
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
$function$;

-- The nights in a range the House Sheet lists and the app has no finalized bed night for (dates only).
create or replace function ops.unfinalized_nights(p_from date, p_to date)
returns setof date language sql stable security definer set search_path = ops, pg_temp as $$
  select distinct sn.night from ops.sheet_nights sn
   where sn.night between p_from and p_to and shared.current_staff_roles() is not null
     and not exists (select 1 from ops.bed_nights b where b.night = sn.night)
   order by 1;
$$;
revoke all on function ops.unfinalized_nights(date, date) from public, anon;
grant execute on function ops.unfinalized_nights(date, date) to authenticated;

notify pgrst, 'reload schema';
