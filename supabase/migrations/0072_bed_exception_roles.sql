-- 0072: who may place a family outside the bed rules (user, 2026-09-28):
-- the social workers, the CEO and the admins (role admin, the Super Admin
-- account included) and Des (role inventory_lead, the only one). Was admin
-- and inventory_lead (0070). Mirrors canAllowBedException in lib/rbac/roles.ts.

create or replace function ops.can_allow_bed_exception() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(shared.current_staff_role() in ('admin', 'social_worker', 'inventory_lead'), false);
$$;

-- Same as 0070; only the refusal's wording names the new roles.
create or replace function ops.enforce_bed_rules(p_unit_id text, p_sex text, p_family uuid, p_ignore_stay uuid, p_ignore_patient uuid, p_exception_reason text)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_problem text := ops.bed_rule_problem(p_unit_id, p_sex, p_family, p_ignore_stay, p_ignore_patient);
begin
  if v_problem is null then
    return null;
  end if;
  if nullif(btrim(p_exception_reason), '') is null then
    raise exception '%', v_problem using errcode = '23514', hint = 'bed_rule';
  end if;
  if not ops.can_allow_bed_exception() then
    raise exception '% -- only a social worker or an admin can allow an exception', v_problem using errcode = '42501';
  end if;
  return v_problem;
end;
$$;
revoke all on function ops.enforce_bed_rules(text, text, uuid, uuid, uuid, text) from public, anon, authenticated;
