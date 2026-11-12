-- 0145 Budgets polish (12 Nov 2026): start a year's budget from an earlier year's.
--
-- A year with no budget yet can start as a copy of an earlier year's approved budget: every item with its twelve
-- months, as a draft to adjust (a revision of the same year is budget_revise, 0137). One transaction.

create or replace function ops.budget_copy(p_from uuid, p_year integer)
returns uuid language plpgsql security definer set search_path = ops, shared, pg_temp as $$
declare
  b ops.budgets;
  v_new uuid;
  i ops.budget_items;
  v_item uuid;
begin
  if not ops.budget_editor() then
    raise exception 'Only Finance or the CEO keys in budgets.' using errcode = '42501';
  end if;
  select * into b from ops.budgets where id = p_from;
  if not found or b.status <> 'approved' or b.year >= p_year then
    raise exception 'Start from an earlier year''s approved budget.' using errcode = '23514';
  end if;
  if exists (select 1 from ops.budgets where year = p_year) then
    raise exception 'The % budget is started already.', p_year using errcode = '23514';
  end if;
  insert into ops.budgets (year, version, status, note)
  values (p_year, 1, 'draft', left('Started from the ' || b.year || ' budget (version ' || b.version || ')', 500)) returning id into v_new;
  for i in select * from ops.budget_items where budget_id = b.id order by sort loop
    insert into ops.budget_items (budget_id, t3_id, label, unit, measure, account_id, sort)
    values (v_new, i.t3_id, i.label, i.unit, i.measure, i.account_id, i.sort) returning id into v_item;
    insert into ops.budget_values (item_id, month, quantity, amount) select v_item, month, quantity, amount from ops.budget_values where item_id = i.id;
  end loop;
  return v_new;
end $$;
revoke all on function ops.budget_copy(uuid, integer) from public;
grant execute on function ops.budget_copy(uuid, integer) to authenticated;

notify pgrst, 'reload schema';
