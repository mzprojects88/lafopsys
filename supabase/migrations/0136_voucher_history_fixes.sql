-- 0136 Voucher System, phase 3: Finance cleans up the vouchers imported from the registers (decided 10 Nov 2026).
--
-- scripts/import-voucher-history.mjs brings the Aug-Oct PV, PCV and GCash registers in as history (source 'sheet'),
-- flagging what doesn't fit the chart, the funds or the register's own totals. Finance (the Finance menu's editors)
-- corrects the fund and each line's account and cost center / program here; each correction is kept in the
-- voucher's history, and the flag clears once every line has a usable account and the voucher a fund. Amounts and
-- the register's own words never change.
create or replace function ops.voucher_fix_history(p_id uuid, p_t2 uuid, p_lines jsonb, p_note text default null)
returns boolean language plpgsql security definer set search_path = ops, shared, pg_temp as $$
declare
  me uuid := auth.uid();
  v ops.vouchers;
  l jsonb;
  v_bad text;
  v_clean boolean;
begin
  if shared.current_staff_roles() is null or shared.module_level('finance') <> 'edit' then
    raise exception 'Only Finance corrects the registers'' vouchers.' using errcode = '42501';
  end if;
  select * into v from ops.vouchers where id = p_id for update;
  if not found or v.source <> 'sheet' then
    raise exception 'Only a voucher from the registers is corrected here.' using errcode = 'P0002';
  end if;
  if p_t2 is not null and not exists (select 1 from ops.fin_codes where id = p_t2 and tier = 'T2' and active) then
    raise exception 'Pick a fund in use.' using errcode = '23514';
  end if;
  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    update ops.voucher_lines vl set account_id = nullif(l->>'account_id', '')::uuid, t1_id = nullif(l->>'t1_id', '')::uuid, t3_id = nullif(l->>'t3_id', '')::uuid
    where vl.id = (l->>'id')::uuid and vl.voucher_id = v.id;
    if not found then
      raise exception 'A line that isn''t on this voucher.' using errcode = '23514';
    end if;
  end loop;
  -- What is set must be usable; what is left empty stays to clean up.
  select string_agg(vl.sort::text, ', ' order by vl.sort) into v_bad
  from ops.voucher_lines vl
  left join ops.coa_accounts a on a.id = vl.account_id
  left join ops.fin_codes t1 on t1.id = vl.t1_id
  left join ops.fin_codes t3 on t3.id = vl.t3_id
  where vl.voucher_id = v.id and (
    (vl.account_id is not null and (a.is_header or not a.active or a.code is null))
    or (vl.t1_id is not null and t1.tier <> 'T1')
    or (vl.t3_id is not null and t3.tier <> 'T3'));
  if v_bad is not null then
    raise exception 'Item % needs a usable account, cost center and program.', v_bad using errcode = '23514';
  end if;
  v_clean := p_t2 is not null and not exists (select 1 from ops.voucher_lines where voucher_id = v.id and (account_id is null or t1_id is null));
  update ops.vouchers set t2_id = p_t2, needs_cleanup = not v_clean where id = v.id;
  insert into ops.voucher_events (voucher_id, action, actor, note, source)
  values (v.id, 'history', me, concat_ws(' ', 'Coding corrected by Finance.', case when v_clean then 'Cleaned up.' end, nullif(btrim(coalesce(p_note, '')), '')), 'app');
  return v_clean;
end $$;
revoke all on function ops.voucher_fix_history(uuid, uuid, jsonb, text) from public;
grant execute on function ops.voucher_fix_history(uuid, uuid, jsonb, text) to authenticated;

notify pgrst, 'reload schema';
