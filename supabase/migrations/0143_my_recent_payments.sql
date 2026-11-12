-- 0143 Voucher System, polish 3 (12 Nov 2026): tell the requester they have been paid.
--
-- The bell reads this for everyone (anyone may file a request), so it returns only the caller's own requests paid
-- (released) in the last 7 days: a few rows, without loading every voucher on every page.

create or replace function ops.my_recent_payments()
returns table (voucher_id uuid, number text, amount numeric, released_at timestamptz)
language sql stable security definer set search_path = ops, shared, pg_temp as $$
  select v.id, coalesce(v.voucher_number, v.request_number), v.total - v.ewt_total, v.released_at
  from ops.vouchers v
  where v.requested_by = auth.uid() and v.source = 'app' and v.status = 'released'
    and v.released_at > now() - interval '7 days'
    and shared.current_staff_roles() is not null
  order by v.released_at desc;
$$;
revoke all on function ops.my_recent_payments() from public;
grant execute on function ops.my_recent_payments() to authenticated;

notify pgrst, 'reload schema';
