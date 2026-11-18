-- 0162 Closing a customer's account also clears the wording of its trail (18 Nov 2026).
--
-- Closing an account removes the customer's details (0160): the address, name, mobile number and delivery
-- address go, and every device is signed out. The account's trail kept the wording of its entries, and that
-- wording can hold a detail: "Sign-in address changed, from <the earlier address>", or a note staff typed when
-- blocking the sign-in. Found while writing the privacy notice, which promises the details are removed.
--
-- From now on the trail of a closed account keeps what happened and when, and who did it, but not the wording.
-- Accounts closed before this change are cleared here too. Orders and gifts are not touched: they are the
-- foundation's sales and donation records and keep the details they were made with.

-- The same function as in 0160, with one statement added (the update of shop.customer_events).
create or replace function shop.customer_close(p_customer uuid, p_staff uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  select email into v_email from shop.customers where id = p_customer and status <> 'closed' for update;
  if not found then return; end if;
  delete from shop.customer_sessions where customer_id = p_customer;
  delete from shop.sign_in_codes where email = v_email or customer_id = p_customer;
  update shop.customers set
    email = 'closed-' || id::text || '@closed.invalid', name = null, phone = null, area = null, province = null, city = null,
    barangay = null, postal_code = null, address_line = null, landmark = null, status = 'closed', status_at = now()
  where id = p_customer;
  update shop.customer_events set detail = null where customer_id = p_customer and detail is not null;
  insert into shop.customer_events (customer_id, event, by_staff_id) values (p_customer, 'closed', p_staff);
end;
$$;

-- Accounts closed before this change.
update shop.customer_events e set detail = null
  from shop.customers c
 where c.id = e.customer_id and c.status = 'closed' and e.detail is not null;

revoke all on function shop.customer_close(uuid, uuid) from public, anon, authenticated, shop_web;
grant execute on all functions in schema shop to service_role;
