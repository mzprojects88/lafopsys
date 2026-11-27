-- 0188: Patients > Direct donations (LAF Inventory 0082: donations a donor gives for the patients themselves, AR series
-- LAF-DTP). The stock, the gives and every rule live in the inventory schema; ArkOS adds two things.
--
--  1. The page "patients.direct" for the roles the owner named (27 Nov 2026), at the level each already holds on the
--     Patients menu, so nobody's access to anything else changes: Social Worker, Office Admin, CEO, Inventory Lead,
--     Inventory Staff (a role without the Patients menu gets no row; the Super Admin opens every page). What a person
--     may do on the page is decided by the database (inventory.can_give_direct and the calls of 0082), not by the level.
--     On production only (the same test as 0174 and 0181): those tables are copied between the databases.
--  2. ops.add_donor_basic (its live definition, 0087): the social worker and the CEO receive these donations too, so
--     they can add a donor who is not in the list yet (name, type and jurisdiction only, as inventory staff do).

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from cron.job where jobname = 'house-sheet-sync') then
    insert into shared.role_page_access (role, page, level)
    select m.role, p.page, m.level
      from shared.module_access m cross join (values ('patients.direct')) p(page)
     where m.module = 'patients' and m.level in ('view', 'edit')
       and m.role in ('social_worker', 'office_admin', 'ceo', 'inventory_lead', 'inventory_staff')
    on conflict do nothing;
  end if;
end $$;

CREATE OR REPLACE FUNCTION ops.add_donor_basic(p_name text, p_type text, p_jurisdiction text DEFAULT 'PH'::text)
 RETURNS TABLE(id uuid, name text, type text, tax_jurisdiction text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ops', 'pg_temp'
AS $function$
declare
  v_name text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_id uuid;
begin
  if not (shared.has_role('chef', 'inventory_staff', 'nutritionist', 'inventory_lead', 'social_worker', 'ceo') or shared.module_editable('donors')) then
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
$function$;
