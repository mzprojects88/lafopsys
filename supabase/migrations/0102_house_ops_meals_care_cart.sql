-- 0102: House Operations shows Meals and Care Cart from LAF Inventory, read only (decided 2026-10-07,
-- built 2026-10-22).
--
-- The kitchen records each meal (inventory.meal_services, Inventory 0035) and each Care Cart run
-- (inventory.care_cart_runs + care_cart_run_dishes, Inventory 0036) in LAF Inventory. Those tables
-- are readable only by inventory roles, so -- like ops.gik_batches (0095) -- these read them as their
-- owner and answer only callers who may view House Operations. Stock cost is the value of the stock
-- drawn for that meal or run (issue transactions linked to it), as Inventory's Reports count it (0045).
-- The old imported ops.meal_services / ops.care_cart_logs stay as history (DSWD figures still read them).

create function ops.house_meals(p_from date, p_to date)
returns table (
  date date, meal_type text, patients integer, carers integer, others integer, served integer,
  dish text, notes text, draw_value numeric
)
language plpgsql stable security definer
set search_path to 'ops', 'inventory', 'pg_temp' as $$
begin
  if not shared.module_viewable('house_ops') then
    raise exception 'House Operations access is needed to see meals' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    raise exception 'Give a date range of up to a year' using errcode = '22023';
  end if;
  return query
    select m.date, m.meal_type, m.patients, m.carers, m.others, (m.patients + m.carers + m.others),
           m.dish, m.notes,
           (select round(sum(t.quantity * l.unit_cost), 2)
              from inventory.transactions t join inventory.lots l on l.id = t.lot_id
             where t.meal_service_id = m.id and t.archived_at is null and t.type = 'issue')
      from inventory.meal_services m
     where m.date between p_from and p_to
     order by m.date desc, array_position(array['breakfast', 'lunch', 'snack', 'dinner'], m.meal_type::text);
end;
$$;
revoke all on function ops.house_meals(date, date) from public;
grant execute on function ops.house_meals(date, date) to authenticated;

create function ops.house_care_cart(p_from date, p_to date)
returns table (
  date date, time_slot text, status text, served integer, source text, sponsor text,
  volunteers integer, volunteer_names text, location text, dishes text, draw_value numeric
)
language plpgsql stable security definer
set search_path to 'ops', 'inventory', 'pg_temp' as $$
begin
  if not shared.module_viewable('house_ops') then
    raise exception 'House Operations access is needed to see the Care Cart' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    raise exception 'Give a date range of up to a year' using errcode = '22023';
  end if;
  return query
    select r.date, r.time_slot, r.delivery_status, r.served_count, r.source, r.sponsor,
           r.volunteer_count, r.volunteer_names, r.location,
           (select string_agg(d.dish || coalesce(' × ' || d.servings, ''), ', ' order by d.sort_order)
              from inventory.care_cart_run_dishes d where d.run_id = r.id),
           (select round(sum(t.quantity * l.unit_cost), 2)
              from inventory.transactions t join inventory.lots l on l.id = t.lot_id
             where t.care_cart_run_id = r.id and t.archived_at is null and t.type = 'issue')
      from inventory.care_cart_runs r
     where r.date between p_from and p_to
     order by r.date desc, r.time_slot;
end;
$$;
revoke all on function ops.house_care_cart(date, date) from public;
grant execute on function ops.house_care_cart(date, date) to authenticated;

notify pgrst, 'reload schema';
