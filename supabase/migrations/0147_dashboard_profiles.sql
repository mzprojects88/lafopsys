-- 0147 Dashboard profiles (user, 12 Nov 2026).
--
-- The dashboard shows the foundation's own figures for any period (Year to date by default): bed nights, rides,
-- meals, child visits, Care Cart meals, unique patients, and, for the office, cash donations, gifts in kind and
-- expenses (paid vouchers). Which cards a role may have is its dashboard profile, set by the Super Admin; each
-- person then picks, orders and dates their own dashboard and their quick actions. New Cash Entry is retired: gifts
-- come in through Donors and Inventory, money goes out through Payment Requests.

-- 1. A role's dashboard profile: the cards it may have (no row = not offered). The Super Admin has every card.
create table if not exists shared.role_dashboard_cards (
  role text not null references shared.roles(key) on delete cascade deferrable initially immediate,
  card text not null check (card in ('housing', 'rides', 'meals', 'child_visits', 'care_cart', 'patients', 'cash', 'gifts', 'expenses',
                                     'in_house', 'since_2024', 'waiting', 'funds', 'budget', 'compliance', 'volunteers', 'stock',
                                     'transport_costs', 'caf_nights', 'staff_in')),
  primary key (role, card)
);
alter table shared.role_dashboard_cards enable row level security;
drop policy if exists "staff read dashboard profiles" on shared.role_dashboard_cards;
create policy "staff read dashboard profiles" on shared.role_dashboard_cards for select to authenticated using (shared.current_staff_roles() is not null);
drop policy if exists "the super admin sets dashboard profiles" on shared.role_dashboard_cards;
create policy "the super admin sets dashboard profiles" on shared.role_dashboard_cards for all to authenticated
  using (shared.has_role('admin')) with check (shared.has_role('admin') and role not in ('admin', 'partner_viewer'));
revoke all on shared.role_dashboard_cards from anon, authenticated;
grant select, insert, delete on shared.role_dashboard_cards to authenticated;

-- The defaults (user, 12 Nov): the program cards for every staff role; the money cards for Office Admin, Finance,
-- the CEO and the Trustees (HR people and the Super Admin always); extras where they fit the work.
insert into shared.role_dashboard_cards (role, card)
select r.key, c.card
from shared.roles r
cross join (values ('housing'), ('rides'), ('meals'), ('child_visits'), ('care_cart'), ('patients'), ('in_house'), ('since_2024'), ('waiting'), ('volunteers')) c(card)
where r.key not in ('admin', 'partner_viewer')
union all
select r.role, c.card
from (values ('office_admin'), ('finance'), ('ceo'), ('board')) r(role)
cross join (values ('cash'), ('gifts'), ('expenses'), ('budget')) c(card)
where exists (select 1 from shared.roles where key = r.role)
union all
select x.role, x.card
from (values ('office_admin', 'funds'), ('finance', 'funds'), ('ceo', 'funds'),
             ('office_admin', 'compliance'), ('finance', 'compliance'), ('ceo', 'compliance'),
             ('inventory_lead', 'stock'), ('inventory_staff', 'stock'), ('chef', 'stock'), ('office_admin', 'stock'),
             ('driver', 'transport_costs'), ('office_admin', 'transport_costs'), ('finance', 'transport_costs'), ('ceo', 'transport_costs'),
             ('social_worker', 'caf_nights'), ('office_admin', 'caf_nights'), ('finance', 'caf_nights'), ('ceo', 'caf_nights'),
             ('office_admin', 'staff_in'), ('finance', 'staff_in'), ('ceo', 'staff_in')) x(role, card)
where exists (select 1 from shared.roles where key = x.role)
on conflict do nothing;

-- Whether the signed-in person's profile has a card: the Super Admin always, a role that has it, and (for the money
-- cards, user 12 Nov) anyone who runs HR.
create or replace function shared.dashboard_card_ok(p_card text)
returns boolean language sql stable security definer set search_path = shared, pg_temp as $$
  select shared.current_staff_roles() is not null and (
    shared.has_role('admin')
    or exists (select 1 from shared.role_dashboard_cards where card = p_card and role = any (shared.current_staff_roles()))
    or (p_card in ('cash', 'gifts', 'expenses', 'budget') and hr.is_hr_staff()));
$$;
revoke all on function shared.dashboard_card_ok(text) from public, anon;
grant execute on function shared.dashboard_card_ok(text) to authenticated;

-- 2. Each person's own dashboard: the cards in their order, their quick actions in order, the period it opens on.
create table if not exists shared.dashboard_layouts (
  staff_id uuid primary key default auth.uid() references shared.staff(id) on delete cascade deferrable initially immediate,
  cards text[] not null default '{}' check (cardinality(cards) <= 40),
  actions text[] not null default '{}' check (cardinality(actions) <= 8),
  period text not null default 'this_year' check (period in ('today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month', 'this_year', 'last_year')),
  updated_at timestamptz not null default now()
);
alter table shared.dashboard_layouts enable row level security;
drop policy if exists "own dashboard" on shared.dashboard_layouts;
create policy "own dashboard" on shared.dashboard_layouts for all to authenticated
  using (staff_id = auth.uid()) with check (staff_id = auth.uid());
revoke all on shared.dashboard_layouts from anon, authenticated;
grant select, insert, update, delete on shared.dashboard_layouts to authenticated;

-- 3. The figures for a period, as totals only, the same for everyone the card is offered to (so nobody sees P0 for
-- want of Donors access): the program lines exactly as the website counts them (0112/0128: per month, the app's
-- figure or the sheet's, whichever is higher), unique children, and the money only for profiles that have it.
create or replace function ops.dashboard_figures(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = ops, inventory, pg_temp as $$
declare
  r jsonb;
  v_year integer := extract(year from p_to)::int;
  v_today date := (now() at time zone 'Asia/Manila')::date;
begin
  if shared.current_staff_roles() is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 3700 then
    raise exception 'Give a date range of up to ten years.' using errcode = '22023';
  end if;
  with lines as (
    select x.line, sum(greatest(x.native, x.from_sheet)) as v from ops.program_impact_range_rows(p_from, p_to, 'month') x group by x.line
  ), ytd as (
    select x.line, sum(greatest(x.native, x.from_sheet)) as v
      from ops.program_impact_range_rows(make_date(extract(year from v_today)::int, 1, 1), v_today, 'month') x
     where x.line in ('housing', 'transport_to_nch', 'transport_to_laf', 'meals_breakfast', 'meals_lunch', 'meals_dinner',
                      'center_nch_participants', 'care_cart_1000', 'care_cart_1200', 'care_cart_1700')
     group by x.line
  ), kids as (
    select coalesce('p:' || hp.matched_patient_id, 'n:' || sn.name_key) as k
      from ops.sheet_nights sn left join ops.house_sheet_people hp on hp.name_key = sn.name_key
     where sn.night between p_from and p_to
    union
    select 'p:' || s.patient_id from ops.bed_nights b join ops.stays s on s.id = b.stay_id where b.night between p_from and p_to
  )
  select jsonb_build_object(
    'lines', coalesce((select jsonb_object_agg(line, v) from lines), '{}'::jsonb),
    'unique_patients', (select count(*) from kids),
    'enrolled', (select count(*) from ops.patients),
    'since_2024', coalesce((select sum(value) from ops.program_history where year < extract(year from v_today)), 0) + coalesce((select sum(v) from ytd), 0),
    'prior_years', (select count(distinct year) from ops.program_history where year < extract(year from v_today))
  ) into r;

  if shared.dashboard_card_ok('cash') then
    r := r || jsonb_build_object('cash', (select jsonb_build_object('amount', coalesce(sum(total_value), 0), 'gifts', count(*))
      from ops.donations where kind = 'cash' and currency = 'PHP' and date between p_from and p_to));
  end if;
  if shared.dashboard_card_ok('gifts') then
    r := r || jsonb_build_object('gifts', (select jsonb_build_object(
        'food', coalesce(sum(l.value) filter (where c.meal_use), 0),
        'non_food', coalesce(sum(l.value) filter (where c.meal_use is not true), 0),
        'receipts', count(distinct d.id))
      from inventory.donation_log d
      left join inventory.donation_lines l on l.donation_id = d.id
      left join inventory.categories c on c.name = l.category
     where d.date between p_from and p_to));
  end if;
  -- Expenses = paid vouchers only (user, 12 Nov): released, by the day paid, gross; a fund top-up only refills a
  -- fund whose slips were already counted, and a liquidation settles its advance (its lines undo the advance).
  if shared.dashboard_card_ok('expenses') then
    r := r || jsonb_build_object('expenses', (select jsonb_build_object('amount', coalesce(sum(total), 0), 'vouchers', count(*))
      from ops.vouchers where status = 'released' and kind <> 'fund_topup'
       and (released_at at time zone 'Asia/Manila')::date between p_from and p_to));
  end if;
  if shared.dashboard_card_ok('budget') then
    r := r || jsonb_build_object('budget', (select jsonb_build_object('year', v_year, 'approved', coalesce(sum(bv.amount), 0),
        'spent', (select coalesce(sum(total), 0) from ops.vouchers where status = 'released' and kind <> 'fund_topup'
                   and (released_at at time zone 'Asia/Manila')::date between make_date(v_year, 1, 1) and least(make_date(v_year, 12, 31), v_today)))
      from ops.budget_values bv join ops.budget_items bi on bi.id = bv.item_id
     where bi.budget_id = (select id from ops.budgets where year = v_year and status = 'approved' order by version desc limit 1)));
  end if;
  return r;
end $$;
revoke all on function ops.dashboard_figures(date, date) from public, anon;
grant execute on function ops.dashboard_figures(date, date) to authenticated;

-- 4. New Cash Entry is retired (user, 12 Nov): the page leaves every role's access.
delete from shared.role_page_access where page = 'finance.entry';

notify pgrst, 'reload schema';
