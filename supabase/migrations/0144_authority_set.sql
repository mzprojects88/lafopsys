-- 0144 Voucher System, polish 4 (12 Nov 2026): the signers set in one form.
--
-- Financial Settings › Authority gets a guided form that fills the whole matrix (endorsers per role, Finance's
-- preparers, the reviewer, approvers by amount, the payment signatory, the releaser). It saves through this function:
-- one transaction, so the matrix is never half replaced, and each row is still logged by log_finance_setup.

create or replace function ops.voucher_authority_set(p_rows jsonb)
returns integer language plpgsql security definer set search_path = ops, shared, pg_temp as $$
declare
  n integer;
begin
  if shared.current_staff_roles() is null or not shared.has_power('finance_setup') then
    raise exception 'Only whoever sets up Finance changes the signers.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'Give the signers.' using errcode = '23514';
  end if;
  delete from ops.voucher_authority;
  insert into ops.voucher_authority (step, requester_role, min_amount, max_amount, staff_id, alternate_staff_id, urgent)
  select r->>'step', nullif(r->>'requester_role', ''), coalesce((r->>'min_amount')::numeric, 0), nullif(r->>'max_amount', '')::numeric,
         nullif(r->>'staff_id', '')::uuid, nullif(r->>'alternate_staff_id', '')::uuid, coalesce((r->>'urgent')::boolean, false)
  from jsonb_array_elements(p_rows) r;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function ops.voucher_authority_set(jsonb) from public;
grant execute on function ops.voucher_authority_set(jsonb) to authenticated;

notify pgrst, 'reload schema';
