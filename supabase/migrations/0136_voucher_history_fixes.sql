-- 0136 Voucher System, phase 3: Finance cleans up the vouchers imported from the registers (decided 10 Nov 2026).
--
-- scripts/import-voucher-history.mjs brings the Aug-Oct PV, PCV and GCash registers in as history (source 'sheet'),
-- with the reasons each needs cleaning up. Finance (the Finance menu's editors) corrects the fund and each line's
-- account and cost center / program here, by the rules preparing a voucher follows (a usable, settled account; cost
-- centers and programs in use; a restricted fund paying only what it allows). A correction clears the coding reasons
-- once the coding is complete; the other reasons (totals that don't agree, a repeated number, a status or date the
-- register doesn't make clear, a negative amount) clear only when Finance says it has checked them. Every correction
-- is kept in the voucher's history. Amounts and the register's own words never change.
alter table ops.vouchers add column if not exists cleanup_reasons text[] not null default '{}';
comment on column ops.vouchers.cleanup_reasons is 'Why a voucher from the registers needs cleaning up (0136): no_fund, unknown_code, name_differs (coding); duplicate_number, total_differs, unknown_status, no_date, negative_amount (to check).';

create or replace function ops.voucher_fix_history(p_id uuid, p_t2 uuid, p_lines jsonb, p_note text default null, p_others_checked boolean default false)
returns boolean language plpgsql security definer set search_path = ops, shared, pg_temp as $$
declare
  me uuid := auth.uid();
  v ops.vouchers;
  f ops.fin_codes;
  l jsonb;
  v_bad text;
  v_reasons text[];
begin
  if shared.current_staff_roles() is null or shared.module_level('finance') <> 'edit' then
    raise exception 'Only Finance corrects the registers'' vouchers.' using errcode = '42501';
  end if;
  select * into v from ops.vouchers where id = p_id for update;
  if not found or v.source <> 'sheet' then
    raise exception 'Only a voucher from the registers is corrected here.' using errcode = 'P0002';
  end if;
  if p_t2 is not null then
    select * into f from ops.fin_codes where id = p_t2 and tier = 'T2' and active;
    if not found then
      raise exception 'Pick a fund in use.' using errcode = '23514';
    end if;
  end if;
  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    update ops.voucher_lines vl set account_id = nullif(l->>'account_id', '')::uuid, t1_id = nullif(l->>'t1_id', '')::uuid, t3_id = nullif(l->>'t3_id', '')::uuid
    where vl.id = (l->>'id')::uuid and vl.voucher_id = v.id;
    if not found then
      raise exception 'A line that isn''t on this voucher.' using errcode = '23514';
    end if;
  end loop;
  -- What is set must be usable (the preparing rules); what is left empty stays to clean up.
  select string_agg(vl.sort::text, ', ' order by vl.sort) into v_bad
  from ops.voucher_lines vl
  left join ops.coa_accounts a on a.id = vl.account_id
  left join ops.fin_codes t1 on t1.id = vl.t1_id
  left join ops.fin_codes t3 on t3.id = vl.t3_id
  where vl.voucher_id = v.id and (
    (vl.account_id is not null and (a.is_header or not a.active or a.code is null or a.review_note is not null))
    or (vl.t1_id is not null and (t1.tier <> 'T1' or not t1.active))
    or (vl.t3_id is not null and (t3.tier <> 'T3' or not t3.active)));
  if v_bad is not null then
    raise exception 'Item % needs a usable account, cost center and program.', v_bad using errcode = '23514';
  end if;
  if f.id is not null and f.restricted and cardinality(f.account_prefixes) > 0 then
    select string_agg(a.code, ', ') into v_bad
    from ops.voucher_lines vl join ops.coa_accounts a on a.id = vl.account_id
    where vl.voucher_id = v.id and not exists (select 1 from unnest(f.account_prefixes) p where a.code like p || '%');
    if v_bad is not null then
      raise exception '% (restricted) may not pay for %.', f.name, v_bad using errcode = '23514';
    end if;
  end if;
  -- The coding reasons go once the coding is complete; the others once Finance says it checked them.
  v_reasons := v.cleanup_reasons;
  if p_t2 is not null and not exists (select 1 from ops.voucher_lines where voucher_id = v.id and (account_id is null or t1_id is null)) then
    v_reasons := array(select r from unnest(v_reasons) r where r not in ('no_fund', 'unknown_code', 'name_differs'));
  end if;
  if p_others_checked then
    v_reasons := array(select r from unnest(v_reasons) r where r in ('no_fund', 'unknown_code', 'name_differs'));
  end if;
  update ops.vouchers set t2_id = p_t2, cleanup_reasons = v_reasons, needs_cleanup = cardinality(v_reasons) > 0 where id = v.id;
  insert into ops.voucher_events (voucher_id, action, actor, note, source)
  values (v.id, 'history', me, concat_ws(' ', 'Coding corrected by Finance.', case when p_others_checked then 'The other flags checked.' end,
    case when cardinality(v_reasons) = 0 then 'Cleaned up.' else 'Still to clean up: ' || array_to_string(v_reasons, ', ') || '.' end,
    nullif(btrim(coalesce(p_note, '')), '')), 'app');
  return cardinality(v_reasons) = 0;
end $$;
revoke all on function ops.voucher_fix_history(uuid, uuid, jsonb, text, boolean) from public;
grant execute on function ops.voucher_fix_history(uuid, uuid, jsonb, text, boolean) to authenticated;

notify pgrst, 'reload schema';
