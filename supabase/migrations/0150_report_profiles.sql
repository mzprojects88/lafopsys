-- 0150 Report profiles and the new report sections (user, 12 Nov 2026; Reports release 2).
--
-- A report profile is a saved report design: which sections in which order, how each is drawn, which comparisons
-- show, the columns and the period it opens on. The Super Admin, the CEO and Finance design them; everyone who may
-- open Reports picks one. ops.report_extra gives the figures the new sections need: the house's beds and families
-- per night, and (only to a dashboard profile with the Expenses card, 0147) expenses from paid vouchers by account
-- and by fund, optionally one fund, with the approved budget for the same days.

create table if not exists ops.report_profiles (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 80),
  description text not null default '' check (length(description) <= 300),
  -- Section keys in the order they print (the app knows the keys; unknown ones are skipped).
  sections text[] not null check (cardinality(sections) between 1 and 30),
  -- Per section, how it is drawn: 'chart' (the default), 'rank' (sideways bars), 'table' (no chart) or 'figures'
  -- (the figures only). Only what the PDF draws.
  charts jsonb not null default '{}'::jsonb check (jsonb_typeof(charts) = 'object'),
  -- Which comparison columns show beside the period: the period before (with the variance), the year to date, the goal.
  comparisons text[] not null default '{previous,ytd,goal}' check (comparisons <@ array['previous', 'ytd', 'goal']),
  columns_mode text not null default 'total' check (columns_mode in ('total', 'columns')),
  period text not null default 'this_month' check (period in ('today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month', 'this_year', 'last_year')),
  -- Limits the expenses to one fund (a T2 code such as OC); the other sections are always the whole foundation's.
  fund_code text check (fund_code is null or length(fund_code) between 1 and 20),
  include_ai boolean not null default true,
  built_in boolean not null default false,
  sort integer not null default 0,
  updated_by uuid references shared.staff(id) on delete set null deferrable initially immediate,
  updated_at timestamptz not null default now()
);
create unique index if not exists report_profiles_name_key on ops.report_profiles (lower(btrim(name)));
alter table ops.report_profiles enable row level security;
drop policy if exists "reports viewers read profiles" on ops.report_profiles;
create policy "reports viewers read profiles" on ops.report_profiles for select to authenticated using ((select shared.module_viewable('reports')));
drop policy if exists "leadership and finance design profiles" on ops.report_profiles;
create policy "leadership and finance design profiles" on ops.report_profiles for all to authenticated
  using ((select shared.has_role('admin', 'ceo', 'finance'))) with check ((select shared.has_role('admin', 'ceo', 'finance')));
revoke all on ops.report_profiles from anon, authenticated;
grant select, insert, update, delete on ops.report_profiles to authenticated;
do $$ begin
  alter publication supabase_realtime add table ops.report_profiles;
exception when duplicate_object then null; end $$;

create or replace function ops.stamp_report_profile()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists stamp_report_profile on ops.report_profiles;
create trigger stamp_report_profile before insert or update on ops.report_profiles for each row execute function ops.stamp_report_profile();

-- The starters (they can be changed or removed like any other).
insert into ops.report_profiles (name, description, sections, charts, comparisons, columns_mode, period, fund_code, built_in, sort)
select * from (values
  ('Executive summary', 'The headline figures with the year to date and the goals, money in and out against the budget, and the AI summary.',
    array['headline', 'housing', 'meals', 'transportation', 'care_cart', 'donations', 'expenses'], '{"housing":"figures","meals":"figures","transportation":"figures","care_cart":"figures"}'::jsonb,
    array['previous', 'ytd', 'goal'], 'total', 'this_month', null::text, true, 10),
  ('Impact report', 'What the foundation delivered: housing and beds, rides, meals, Care Cart, the Activity Center and the children served.',
    array['headline', 'housing', 'occupancy', 'transportation', 'meals', 'care_cart', 'center', 'activities'], '{}'::jsonb,
    array['previous', 'ytd', 'goal'], 'columns', 'this_year', null, true, 20),
  ('Financial report', 'Money in and out: cash donations, gifts in kind, expenses by account and by fund against the budget, and NCH billing.',
    array['donations', 'inventory', 'expenses', 'caf'], '{}'::jsonb,
    array['previous', 'ytd', 'goal'], 'total', 'this_month', null, true, 30),
  ('One Child report', 'What was paid from the One Child fund, by account. The other sections are not split by fund, so this report has only the fund''s spending.',
    array['expenses'], '{}'::jsonb,
    array['previous', 'ytd'], 'total', 'this_month', 'OC', true, 40),
  ('Operations report', 'Running the house: occupancy and beds, transport and fuel, staff hours and the goods received.',
    array['occupancy', 'housing', 'transportation', 'staff', 'inventory'], '{}'::jsonb,
    array['previous', 'ytd'], 'total', 'this_month', null, true, 50)
) v(name, description, sections, charts, comparisons, columns_mode, period, fund_code, built_in, sort)
where not exists (select 1 from ops.report_profiles p where lower(btrim(p.name)) = lower(v.name));

-- The figures of the new sections for a range.
-- Occupancy: the active beds (regular and temporary apart) and the families housed each night, from the app's
-- finalized nights, else (for nights already past, as 0148) the House Sheet's names, dismissed ones aside; nights
-- after today are not counted.
-- Expenses: paid vouchers by the day paid, gross, without fund top-ups and cash advances (as 0147), by account and by
-- fund, optionally one fund; and the approved budget for the same days (each month's amount by the share of its days
-- in the range), for a dashboard profile with the Expenses card.
create or replace function ops.report_extra(p_from date, p_to date, p_fund text default null)
returns jsonb language plpgsql stable security definer set search_path = ops, pg_temp as $$
declare
  r jsonb;
  v_to date := least(p_to, (now() at time zone 'Asia/Manila')::date);
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
     where sn.night between p_from and least(v_to, (now() at time zone 'Asia/Manila')::date - 1) and coalesce(hp.match_status, 'unmatched') <> 'dismissed'
       and not exists (select 1 from ops.bed_nights b where b.night = sn.night)
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
        select m::date as month, (least(p_to, (m + interval '1 month - 1 day')::date) - greatest(p_from, m::date) + 1)::numeric
                 / extract(day from (m + interval '1 month - 1 day'))::numeric as share
          from generate_series(date_trunc('month', p_from::timestamp), p_to::timestamp, interval '1 month') m
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
        'budget', (select round(amount, 2) from budget),
        'by_account', coalesce((select jsonb_agg(x order by x.amount desc) from (
            select coalesce(a.code, nullif(l.legacy_code, ''), '—') as code, coalesce(a.name, nullif(l.legacy_name, ''), 'Not coded') as name, sum(l.amount) as amount
              from lines l left join ops.coa_accounts a on a.id = l.account_id group by 1, 2) x), '[]'::jsonb),
        'by_fund', coalesce((select jsonb_agg(x order by x.amount desc) from (
            select coalesce(f.code, '—') as code, coalesce(f.name, 'No fund') as name, sum(l.amount) as amount
              from lines l left join ops.fin_codes f on f.id = l.t2_id group by 1, 2) x), '[]'::jsonb)
      )));
  end if;
  return r;
end $$;
revoke all on function ops.report_extra(date, date, text) from public, anon;
grant execute on function ops.report_extra(date, date, text) to authenticated;

-- The report generator is the Reports landing page now: its own page row is retired.
delete from shared.role_page_access where page = 'reports.generate';

notify pgrst, 'reload schema';
