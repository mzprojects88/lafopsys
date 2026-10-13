-- 0087: inventory roles see donor names, not donor details (Sprint 6 security item, 2026-10-13).
--
-- Since 0016 the four inventory roles (chef, inventory_staff, nutritionist, inventory_lead) could
-- read every column of ops.donors -- email, phone, TIN, address, totals -- because LAF Inventory
-- needs to name donors on receipts. Inventory only ever uses id, name, type and tax jurisdiction,
-- so those come from a function now and the table-wide read goes:
--
--   1. ops.donor_directory(search | ids | type): the four columns, any signed-in staff member.
--   2. ops.donor_name(id): one name, for labels inside Inventory's own functions.
--   3. ops.add_donor_basic(name, type, jurisdiction): the Inventory "New donor" door; a name
--      already on the list (same key as ops.donor_name_key) returns that donor instead of a twin.
--   4. The two policies that let inventory roles read and insert ops.donors directly are dropped
--      by 0088, once LAF Inventory's release that uses these functions is live (the deployed
--      Inventory still reads the table until then). Donors editors keep the module policies.

create or replace function ops.donor_directory(p_search text default null, p_ids uuid[] default null, p_type text default null, p_limit integer default 20)
returns table (id uuid, name text, type text, tax_jurisdiction text)
language sql stable security definer
set search_path to 'ops', 'pg_temp' as $$
  select d.id, d.name, d.type, d.tax_jurisdiction
  from ops.donors d
  where coalesce(cardinality(shared.current_staff_roles()), 0) > 0
    and (p_ids is null or d.id = any (p_ids))
    and (p_type is null or d.type = p_type)
    and (p_search is null or btrim(p_search) = '' or d.name ilike '%' || btrim(p_search) || '%')
  order by d.name
  limit least(greatest(coalesce(p_limit, 20), 1), 200);
$$;
revoke all on function ops.donor_directory(text, uuid[], text, integer) from public, anon;
grant execute on function ops.donor_directory(text, uuid[], text, integer) to authenticated;

create or replace function ops.donor_name(p_id uuid)
returns text language sql stable security definer
set search_path to 'ops', 'pg_temp' as $$
  select d.name from ops.donors d where d.id = p_id and coalesce(cardinality(shared.current_staff_roles()), 0) > 0;
$$;
revoke all on function ops.donor_name(uuid) from public, anon;
grant execute on function ops.donor_name(uuid) to authenticated;

create or replace function ops.add_donor_basic(p_name text, p_type text, p_jurisdiction text default 'PH')
returns table (id uuid, name text, type text, tax_jurisdiction text)
language plpgsql security definer
set search_path to 'ops', 'pg_temp' as $$
declare
  v_name text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_id uuid;
begin
  if not (shared.has_role('chef', 'inventory_staff', 'nutritionist', 'inventory_lead') or shared.module_editable('donors')) then
    raise exception 'Only inventory staff and donors editors add donors.' using errcode = '42501';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 200 then
    raise exception 'Enter the donor''s name (2 to 200 characters).' using errcode = '22023';
  end if;
  if p_type not in ('individual', 'corporate', 'foundation', 'government') then
    raise exception 'Donor type must be individual, corporate, foundation or government.' using errcode = '22023';
  end if;
  if p_jurisdiction not in ('PH', 'US') then
    raise exception 'Tax jurisdiction must be PH or US.' using errcode = '22023';
  end if;
  -- The same name typed again is the same donor.
  select d.id into v_id from ops.donors d where d.type <> 'anonymous' and ops.donor_name_key(d.name) = ops.donor_name_key(v_name) order by d.created_at limit 1;
  if v_id is null then
    insert into ops.donors (name, type, tax_jurisdiction) values (v_name, p_type, p_jurisdiction) returning donors.id into v_id;
  end if;
  return query select d.id, d.name, d.type, d.tax_jurisdiction from ops.donors d where d.id = v_id;
end;
$$;
revoke all on function ops.add_donor_basic(text, text, text) from public, anon;
grant execute on function ops.add_donor_basic(text, text, text) to authenticated;

notify pgrst, 'reload schema';
