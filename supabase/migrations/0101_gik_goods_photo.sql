-- 0101: the photo of the goods on each AR, in Donors > Totals (user, 2026-10-21).
--
-- LAF Inventory keeps one optional photo of the goods per receipt (Inventory 0064,
-- inventory.donation_log.goods_photo_key; apply that first). The receipts are readable only by
-- inventory roles, so, like gik_batches (0095), these read them as their owner and answer only
-- callers who may view Donors.
--
--   1. ops.gik_batches: also has_photo (the result shape changes, so it is dropped and made again).
--   2. ops.gik_goods_photo_key(receipt): the photo's storage key, for /api/donors/goods-photo, which
--      streams the image so the storage link never reaches the browser.

drop function ops.gik_batches(date, date);
create function ops.gik_batches(p_from date, p_to date)
returns table (
  receipt_id text, date date, donor_id uuid, ar_number text, booklet_ar_number text,
  lines integer, food_value numeric, nonfood_value numeric, total_value numeric, has_photo boolean
)
language plpgsql stable security definer
set search_path to 'ops', 'inventory', 'pg_temp' as $$
begin
  if not shared.module_viewable('donors') then
    raise exception 'Donors access is needed to see donation totals' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 3700 then
    raise exception 'Give a date range of up to ten years' using errcode = '22023';
  end if;
  return query
    select r.id, r.date, r.donor_id, r.ar_number, r.booklet_ar_number,
           count(l.id)::int,
           coalesce(sum(l.value) filter (where c.meal_use), 0)::numeric,
           coalesce(sum(l.value) filter (where c.meal_use is not true), 0)::numeric,
           coalesce(sum(l.value), 0)::numeric,
           r.goods_photo_key is not null
      from inventory.donation_log r
      left join inventory.donation_lines l on l.donation_id = r.id
      left join inventory.categories c on c.name = l.category
     where r.date between p_from and p_to
     group by r.id
     order by r.date desc, r.id;
end;
$$;
revoke all on function ops.gik_batches(date, date) from public;
grant execute on function ops.gik_batches(date, date) to authenticated;

create function ops.gik_goods_photo_key(p_receipt_id text)
returns text
language plpgsql stable security definer
set search_path to 'ops', 'inventory', 'pg_temp' as $$
begin
  if not shared.module_viewable('donors') then
    raise exception 'Donors access is needed to see the photo' using errcode = '42501';
  end if;
  return (select goods_photo_key from inventory.donation_log where id = p_receipt_id);
end;
$$;
revoke all on function ops.gik_goods_photo_key(text) from public;
grant execute on function ops.gik_goods_photo_key(text) to authenticated;

notify pgrst, 'reload schema';
