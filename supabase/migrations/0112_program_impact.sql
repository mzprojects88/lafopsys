-- 0112: the Program Impact report from the app's own records (user, 2026-10-26).
--
-- The LAF Programs sheet's "Report" tab (Housing, Transportation, Meals, Care Cart, LAF Center,
-- CAF; five YTD totals for the website) becomes a page computed live from what staff encode:
-- bed nights x people with the child, trips x passengers, meal ticks, Inventory Care Cart runs,
-- Activity Center sessions. Each line also carries the figure the sheets gave for the same month
-- (what the syncs loaded) so the page shows "App" against "from sheet" until each source is
-- switched off. Social media posts are not kept (user).
--
--   1. stays.people_with_child -- carers and companions staying with the child (the sheet's BN - 1);
--      copied onto the next night's stay by the daily reset (same visit).
--   2. trip_passengers.people   -- one passenger row usually rides as two (child + carer).
--   3. activity_sessions.site   -- NCH (the LAF Center at the hospital) or LAF (the house).
--   4. ops.program_history      -- 2024 / 2025 totals typed once for the website's prior-year columns.
--   5. ops.program_impact(year) -- one row per line and month: native and from_sheet (reports viewers).
--   6. ops.website_dashboard()  -- the five YTD figures + prior years, for the public JSON.
--   7. Reports > Programs page level for the roles that read Reports.

-- ---- 1. people with the child ----
alter table ops.stays add column people_with_child smallint not null default 1 check (people_with_child between 0 and 6);
comment on column ops.stays.people_with_child is 'Carers and companions staying with the child this night (0112); a night counts 1 + this many people.';
update ops.stays set people_with_child = case when carer_id is null then 0 else 1 end;

create or replace function ops.carry_people_with_child()
returns trigger language plpgsql security definer
set search_path to 'ops', 'pg_temp' as $$
declare
  v smallint;
begin
  -- The daily reset makes tonight's stay from last night's (same visit): keep the family's count.
  if new.visit_id is not null then
    select people_with_child into v from ops.stays where visit_id = new.visit_id and id <> new.id order by check_in_at desc limit 1;
    if found then new.people_with_child := v; end if;
  end if;
  return new;
end;
$$;
create trigger carry_people_with_child before insert on ops.stays for each row execute function ops.carry_people_with_child();

-- ---- 2. passengers ----
alter table ops.trip_passengers add column people smallint not null default 2 check (people between 1 and 6);
comment on column ops.trip_passengers.people is 'People riding on this passenger row: the child and whoever goes with them (0112).';

-- ---- 3. session site ----
alter table ops.activity_sessions add column site text not null default 'NCH' check (site in ('NCH', 'LAF'));
update ops.activity_sessions set site = 'LAF' where title ~* '@ LAF' or title ~* 'LAF House';
comment on column ops.activity_sessions.site is 'NCH = the LAF Center at the hospital; LAF = activities at LAF House (0112).';

-- ---- 4. prior years ----
create table ops.program_history (
  year integer not null check (year between 2020 and 2100),
  line text not null check (line in ('housing', 'transportation', 'meals', 'center', 'care_cart')),
  value numeric(12, 2) not null check (value >= 0),
  updated_by uuid references shared.staff (id),
  updated_at timestamptz not null default now(),
  primary key (year, line)
);
comment on table ops.program_history is 'Program totals of the years before the app, typed once for the website''s prior-year columns (0112).';
alter table ops.program_history enable row level security;
create policy "reports viewers read program history" on ops.program_history for select to authenticated
  using ((select shared.module_viewable('reports')));
create policy "finance work writes program history" on ops.program_history for all to authenticated
  using (shared.has_power('finance_work') or shared.has_role('admin')) with check (shared.has_power('finance_work') or shared.has_role('admin'));
revoke all on ops.program_history from anon, authenticated;
grant select, insert, update, delete on ops.program_history to authenticated;

-- ---- 5. the report ----
-- The rows, read as the owner (no caller check): only the two doors below may call it.
-- native = from records staff made in the app; from_sheet = what the sheet syncs loaded for the same
-- month (Programs month tabs, sheet-adopted Care Cart runs and sessions, House Sheet nights).
create or replace function ops.program_impact_rows(p_year integer)
returns table (line text, month integer, native numeric, from_sheet numeric)
language sql stable security definer
set search_path to 'ops', 'inventory', 'pg_temp' as $$
  with months as (select generate_series(1, 12) as m),
  lines as (
    select unnest(array['housing', 'transport_to_nch', 'transport_to_laf', 'meals_breakfast', 'meals_lunch', 'meals_dinner',
                        'care_cart_1000', 'care_cart_1200', 'care_cart_1700', 'care_cart_volunteers',
                        'center_nch_participants', 'center_nch_hours', 'center_nch_volunteers', 'center_laf_volunteers', 'caf_nights']) as l
  ),
  native as (
    select 'housing' as l, extract(month from bn.night)::int as m, sum(1 + s.people_with_child)::numeric as v
      from ops.bed_nights bn join ops.stays s on s.id = bn.stay_id where extract(year from bn.night) = p_year group by 2
    union all
    select case t.direction when 'to_hospital' then 'transport_to_nch' else 'transport_to_laf' end, extract(month from t.date)::int, sum(tp.people)::numeric
      from ops.trips t join ops.trip_passengers tp on tp.trip_id = t.id
     where extract(year from t.date) = p_year and t.status <> 'cancelled' and t.direction in ('to_hospital', 'from_hospital') group by 1, 2
    union all
    select 'meals_' || ms.meal, extract(month from ms.date)::int, sum(1 + coalesce(st.people_with_child, 1))::numeric
      from ops.meals_served ms
      left join lateral (select people_with_child from ops.stays s where s.patient_id = ms.patient_id and s.check_in_at::date <= ms.date
                           and (s.check_out_at is null or s.check_out_at::date >= ms.date) order by s.check_in_at desc limit 1) st on true
     where extract(year from ms.date) = p_year group by 1, 2
    union all
    select 'care_cart_' || replace(c.time_slot, ':', ''), extract(month from c.date)::int, sum(coalesce(c.served_count, 0))::numeric
      from inventory.care_cart_runs c where c.sheet_key is null and c.delivery_status <> 'cancelled' and extract(year from c.date) = p_year and c.time_slot in ('10:00', '12:00', '17:00') group by 1, 2
    union all
    select 'care_cart_volunteers', extract(month from c.date)::int, sum(coalesce(c.volunteer_count, 0))::numeric
      from inventory.care_cart_runs c where c.sheet_key is null and c.delivery_status <> 'cancelled' and extract(year from c.date) = p_year group by 2
    union all
    select 'center_nch_participants', extract(month from a.date)::int, sum(a.participants)::numeric from ops.activity_sessions a where a.source = 'app' and a.site = 'NCH' and extract(year from a.date) = p_year group by 2
    union all
    select 'center_nch_hours', extract(month from a.date)::int, sum(a.hours)::numeric from ops.activity_sessions a where a.source = 'app' and a.site = 'NCH' and extract(year from a.date) = p_year group by 2
    union all
    select 'center_nch_volunteers', extract(month from a.date)::int, sum(a.volunteer_count)::numeric from ops.activity_sessions a where a.source = 'app' and a.site = 'NCH' and extract(year from a.date) = p_year group by 2
    union all
    select 'center_laf_volunteers', extract(month from a.date)::int, sum(a.volunteer_count)::numeric from ops.activity_sessions a where a.source = 'app' and a.site = 'LAF' and extract(year from a.date) = p_year group by 2
    union all
    select 'caf_nights', extract(month from bn.night)::int, count(*)::numeric
      from ops.bed_nights bn join ops.stays s on s.id = bn.stay_id join ops.patients p on p.id = s.patient_id
     where p.caf_billing and extract(year from bn.night) = p_year group by 2
  ),
  from_sheet as (
    select 'housing' as l, extract(month from sm.date)::int as m, sum(coalesce(sm.bn, 0))::numeric as v from ops.sheet_meals sm where extract(year from sm.date) = p_year group by 2
    union all
    select 'meals_breakfast', extract(month from sm.date)::int, sum(sm.breakfast)::numeric from ops.sheet_meals sm where extract(year from sm.date) = p_year group by 2
    union all
    select 'meals_lunch', extract(month from sm.date)::int, sum(sm.lunch)::numeric from ops.sheet_meals sm where extract(year from sm.date) = p_year group by 2
    union all
    select 'meals_dinner', extract(month from sm.date)::int, sum(sm.dinner)::numeric from ops.sheet_meals sm where extract(year from sm.date) = p_year group by 2
    union all
    select 'care_cart_' || replace(c.time_slot, ':', ''), extract(month from c.date)::int, sum(coalesce(c.served_count, 0))::numeric
      from inventory.care_cart_runs c where c.sheet_key is not null and c.delivery_status <> 'cancelled' and extract(year from c.date) = p_year and c.time_slot in ('10:00', '12:00', '17:00') group by 1, 2
    union all
    select 'care_cart_volunteers', extract(month from c.date)::int, sum(coalesce(c.volunteer_count, 0))::numeric
      from inventory.care_cart_runs c where c.sheet_key is not null and c.delivery_status <> 'cancelled' and extract(year from c.date) = p_year group by 2
    union all
    select 'center_nch_participants', extract(month from a.date)::int, sum(a.participants)::numeric from ops.activity_sessions a where a.source = 'sheet' and a.site = 'NCH' and extract(year from a.date) = p_year group by 2
    union all
    select 'center_nch_hours', extract(month from a.date)::int, sum(a.hours)::numeric from ops.activity_sessions a where a.source = 'sheet' and a.site = 'NCH' and extract(year from a.date) = p_year group by 2
    union all
    select 'center_nch_volunteers', extract(month from a.date)::int, sum(a.volunteer_count)::numeric from ops.activity_sessions a where a.source = 'sheet' and a.site = 'NCH' and extract(year from a.date) = p_year group by 2
    union all
    select 'center_laf_volunteers', extract(month from a.date)::int, sum(a.volunteer_count)::numeric from ops.activity_sessions a where a.source = 'sheet' and a.site = 'LAF' and extract(year from a.date) = p_year group by 2
    union all
    select 'caf_nights', extract(month from r.night)::int, count(*)::numeric
      from ops.nightly_record r join ops.patients p on p.id = r.patient_id
     where r.source = 'sheet' and p.caf_billing and extract(year from r.night) = p_year group by 2
  )
  select lines.l, months.m, coalesce(n.v, 0), coalesce(f.v, 0)
    from lines cross join months
    left join native n on n.l = lines.l and n.m = months.m
    left join from_sheet f on f.l = lines.l and f.m = months.m
   order by lines.l, months.m;
$$;
revoke all on function ops.program_impact_rows(integer) from public, anon, authenticated;

-- The page's door: anyone who may read Reports.
create or replace function ops.program_impact(p_year integer)
returns table (line text, month integer, native numeric, from_sheet numeric)
language plpgsql stable security definer
set search_path to 'ops', 'pg_temp' as $$
begin
  if not shared.module_viewable('reports') then
    raise exception 'Reports access is needed to see the Programs report' using errcode = '42501';
  end if;
  if p_year is null or p_year < 2020 or p_year > 2100 then
    raise exception 'Give a year' using errcode = '22023';
  end if;
  return query select r.line, r.month, r.native, r.from_sheet from ops.program_impact_rows(p_year) r;
end;
$$;
revoke all on function ops.program_impact(integer) from public, anon;
grant execute on function ops.program_impact(integer) to authenticated;

-- ---- 6. the website's five numbers ----
-- A month's figure is the larger of the app's and the sheet's (the sheet's until a source is
-- switched off, the app's after). Prior years come from program_history. Five totals, nothing else:
-- the public door is the server route with the service role.
create or replace function ops.website_dashboard()
returns jsonb language sql stable security definer
set search_path to 'ops', 'pg_temp' as $$
  with y as (select extract(year from (now() at time zone 'Asia/Manila'))::int as year),
  r as (select x.line, sum(greatest(x.native, x.from_sheet)) as v from y, lateral ops.program_impact_rows(y.year) x group by x.line),
  ytd as (
    select
      coalesce((select v from r where line = 'housing'), 0) as housing,
      coalesce((select sum(v) from r where line in ('transport_to_nch', 'transport_to_laf')), 0) as transportation,
      coalesce((select sum(v) from r where line in ('meals_breakfast', 'meals_lunch', 'meals_dinner')), 0) as meals,
      coalesce((select v from r where line = 'center_nch_participants'), 0) as center,
      coalesce((select sum(v) from r where line in ('care_cart_1000', 'care_cart_1200', 'care_cart_1700')), 0) as care_cart
  )
  select jsonb_build_object(
    'year', (select year from y),
    'ytd', (select to_jsonb(ytd) from ytd),
    'prior', coalesce((select jsonb_object_agg(h.year::text, h.lines) from (select year, jsonb_object_agg(line, value) as lines from ops.program_history group by year) h), '{}'::jsonb),
    'as_of', to_char(now() at time zone 'Asia/Manila', 'YYYY-MM-DD HH24:MI')
  );
$$;
revoke all on function ops.website_dashboard() from public, anon, authenticated;
grant execute on function ops.website_dashboard() to service_role;

-- ---- 7. the page for the roles that read Reports ----
insert into shared.role_page_access (role, page, level)
select r.role, p.page, r.level
  from shared.role_page_access r cross join (values ('reports.programs')) p(page)
 where r.page = 'reports.catalogue'
on conflict do nothing;

notify pgrst, 'reload schema';
