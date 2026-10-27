-- 0115: Finance › Accounts, Budget vs Actual and Cost per outcome on the real records (Sprint 10).
--
-- The three pages were prototype screens. From here:
--   * Accounts: finance adds the bank and cash-on-hand accounts. A bank account's balance is the
--     last line of its imported statement; a cash box's is typed, with the day it was counted.
--   * Budget: a monthly amount per EXPENSE PURPOSE (the list in Settings › Executive summary, the
--     same purposes every bank debit carries since 0114). The actual is that month's debits with
--     that purpose, worked out on the page; nothing is typed twice. (Budgeting by program would
--     need an allocation of each payment to programs, which LAF does not keep.)
--   * Cost per outcome: per month, what the money and the donated goods bought, against what the
--     house delivered (the Programs report's people-nights, meals, rides and Care Cart servings).

-- ---- 1. accounts ----
alter table ops.accounts add column if not exists balance_as_of date;
comment on column ops.accounts.balance_as_of is
  'For a cash-on-hand account: the day the typed balance was counted (0115). A bank account''s balance comes from its last imported statement line.';

-- ---- 2. budget by purpose ----
alter table ops.budget_lines alter column program_id drop not null;
alter table ops.budget_lines add column if not exists purpose text check (purpose is null or length(purpose) between 1 and 60);
alter table ops.budget_lines drop constraint if exists budget_lines_what;
alter table ops.budget_lines add constraint budget_lines_what check (purpose is not null or program_id is not null);
alter table ops.budget_lines drop constraint if exists budget_lines_month_format;
alter table ops.budget_lines add constraint budget_lines_month_format check (month ~ '^\d{4}-(0[1-9]|1[0-2])$');
alter table ops.budget_lines drop constraint if exists budget_lines_purpose_month;
alter table ops.budget_lines add constraint budget_lines_purpose_month unique (purpose, month);
comment on column ops.budget_lines.purpose is 'What the money is budgeted for: one of the expense purposes in Settings (0115). The actual is the month''s bank debits with that purpose.';

-- ---- 3. cost per outcome ----
-- Purposes are matched by words, not exact names, so renaming "Food and groceries" in Settings keeps working.
create or replace function ops.cost_per_outcome(p_year integer)
returns table (
  month integer,
  spending numeric,
  people_nights numeric,
  food_cash numeric,
  food_goods numeric,
  meals numeric,
  transport_cash numeric,
  rides numeric,
  care_cart_goods numeric,
  care_cart_servings numeric
)
language plpgsql
stable
security definer
set search_path = ops, inventory, shared, pg_temp
as $$
begin
  if not shared.module_viewable('finance') then
    raise exception 'Cost per outcome is for finance viewers' using errcode = '42501';
  end if;
  if p_year not between 2020 and 2100 then
    raise exception 'Year out of range';
  end if;
  return query
  with m as (select generate_series(1, 12) as mo),
  debits as (
    select extract(month from t.posting_date)::int as mo, t.debit, coalesce(t.purpose, '') as purpose
    from ops.bank_transactions t
    where extract(year from t.posting_date) = p_year and t.debit > 0
  ),
  impact as (
    select r.month as mo,
           sum(greatest(r.native, r.from_sheet)) filter (where r.line = 'housing') as nights,
           sum(greatest(r.native, r.from_sheet)) filter (where r.line like 'meals_%') as meals,
           sum(greatest(r.native, r.from_sheet)) filter (where r.line like 'transport_%') as rides,
           sum(greatest(r.native, r.from_sheet)) filter (where r.line in ('care_cart_1000', 'care_cart_1200', 'care_cart_1700')) as servings
    from ops.program_impact_rows(p_year) r
    group by r.month
  ),
  goods as (
    select extract(month from t.date)::int as mo,
           sum(t.quantity * coalesce(l.unit_cost, 0)) filter (where t.channel = 'kitchen') as food,
           sum(t.quantity * coalesce(l.unit_cost, 0)) filter (where t.channel = 'care_cart') as care_cart
    from inventory.transactions t
    join inventory.lots l on l.id = t.lot_id
    where t.type = 'issue' and t.archived_at is null and extract(year from t.date) = p_year
    group by 1
  )
  select m.mo,
         coalesce((select sum(d.debit) from debits d where d.mo = m.mo and d.purpose !~* 'transfer between'), 0),
         coalesce(i.nights, 0),
         coalesce((select sum(d.debit) from debits d where d.mo = m.mo and d.purpose ~* 'food|grocer'), 0),
         round(coalesce(g.food, 0), 2),
         coalesce(i.meals, 0),
         coalesce((select sum(d.debit) from debits d where d.mo = m.mo and d.purpose ~* 'transport|fuel'), 0),
         coalesce(i.rides, 0),
         round(coalesce(g.care_cart, 0), 2),
         coalesce(i.servings, 0)
  from m
  left join impact i on i.mo = m.mo
  left join goods g on g.mo = m.mo
  order by m.mo;
end;
$$;
revoke all on function ops.cost_per_outcome(integer) from public, anon;
grant execute on function ops.cost_per_outcome(integer) to authenticated;
