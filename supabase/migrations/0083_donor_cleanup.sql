-- 0083: donor clean-up -- suggestions staff approve, merging duplicates, salutations
-- (Sprint 6, decided by the user 2026-10-07/08).
--
-- LAF's donor names were typed many ways (86 in ALL CAPS, titles inside names, the same donor
-- twice). Rules and the AI now *suggest*; a donors editor approves, edits or rejects each one.
-- Nothing changes on its own.
--
--   1. ops.donors.salutation: "Mr.", "Ma'am"... kept out of the name.
--   2. ops.donor_suggestions: one row per suggestion (format = new name/salutation/type,
--      merge = fold another donor into this one, incomplete = the name needs a full name), with
--      its reason and source (rule or AI). Editors may add pending suggestions; deciding goes
--      only through the functions below.
--   3. ops.merge_donors(keep, drop, reason): moves every gift, pledge, campaign commitment,
--      inventory receipt, GIK import row, tracker line and the portal account to the kept donor,
--      fills its missing email/phone/TIN/salutation from the other, logs the merge in
--      ops.donor_merges (with a copy of the removed donor), then removes it. Totals follow by
--      themselves (0082). Refused if both donors have a portal account.
--   4. ops.apply_donor_suggestion / ops.reject_donor_suggestion: the decision, stamped with who
--      and when; a format suggestion may be edited before it is applied.

alter table ops.donors add column if not exists salutation text check (salutation is null or char_length(salutation) between 1 and 20);

create table ops.donor_suggestions (
  id uuid primary key default gen_random_uuid(),
  donor_id uuid not null references ops.donors (id) on delete cascade,
  kind text not null check (kind in ('format', 'merge', 'incomplete')),
  proposed jsonb not null default '{}'::jsonb,
  reason text not null default '' check (char_length(reason) <= 500),
  source text not null check (source in ('rule', 'ai')),
  status text not null default 'pending' check (status in ('pending', 'applied', 'rejected')),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) <= 500)
);
-- One open suggestion per donor and kind (per other donor, for merges).
create unique index donor_suggestions_one_open on ops.donor_suggestions (donor_id, kind, coalesce(proposed ->> 'merge', ''))
  where status = 'pending';

create table ops.donor_merges (
  id uuid primary key default gen_random_uuid(),
  kept_id uuid not null,
  dropped_id uuid not null,
  dropped jsonb not null,
  moved jsonb not null,
  reason text not null,
  merged_by uuid,
  merged_at timestamptz not null default now()
);

alter table ops.donor_suggestions enable row level security;
alter table ops.donor_merges enable row level security;
revoke all on ops.donor_suggestions from public, anon, authenticated;
revoke all on ops.donor_merges from public, anon, authenticated;
grant select, insert on ops.donor_suggestions to authenticated;
grant select on ops.donor_merges to authenticated;
create policy "donors viewers read" on ops.donor_suggestions for select to authenticated
  using ((select shared.module_viewable('donors')));
create policy "donors editors suggest" on ops.donor_suggestions for insert to authenticated
  with check ((select shared.module_editable('donors')) and status = 'pending' and decided_by is null and decided_at is null);
create policy "donors viewers read" on ops.donor_merges for select to authenticated
  using ((select shared.module_viewable('donors')));

create or replace function ops.merge_donors(p_keep uuid, p_drop uuid, p_reason text)
returns jsonb language plpgsql security definer
set search_path to 'ops', 'pg_temp' as $$
declare
  keep_row ops.donors;
  drop_row ops.donors;
  moved jsonb := '{}'::jsonb;
  n integer;
  t text;
begin
  if not shared.module_editable('donors') then
    raise exception 'Only donors editors can merge donors.' using errcode = '42501';
  end if;
  if p_keep is null or p_drop is null or p_keep = p_drop then
    raise exception 'Choose two different donors.' using errcode = '22023';
  end if;
  if char_length(coalesce(btrim(p_reason), '')) < 3 then
    raise exception 'Say why these are the same donor.' using errcode = '22023';
  end if;
  select * into keep_row from ops.donors where id = p_keep for update;
  select * into drop_row from ops.donors where id = p_drop for update;
  if keep_row.id is null or drop_row.id is null then
    raise exception 'One of the donors no longer exists.' using errcode = '22023';
  end if;
  if exists (select 1 from shared.donor_accounts where donor_id = p_keep) and exists (select 1 from shared.donor_accounts where donor_id = p_drop) then
    raise exception 'Both donors have a VIP portal account; remove one first.' using errcode = '22023';
  end if;

  update ops.donations set donor_id = p_keep where donor_id = p_drop; get diagnostics n = row_count; moved := moved || jsonb_build_object('donations', n);
  update ops.donor_pledges set donor_id = p_keep where donor_id = p_drop; get diagnostics n = row_count; moved := moved || jsonb_build_object('pledges', n);
  update ops.campaign_commitments set donor_id = p_keep where donor_id = p_drop; get diagnostics n = row_count; moved := moved || jsonb_build_object('commitments', n);
  update shared.donor_accounts set donor_id = p_keep where donor_id = p_drop; get diagnostics n = row_count; moved := moved || jsonb_build_object('portal_account', n);
  -- LAF Inventory's records of the same donor (and the staging copy, where it exists).
  foreach t in array array['inventory', 'inventory_staging'] loop
    if to_regclass(t || '.donation_log') is not null then
      execute format('update %I.donation_log set donor_id = $1 where donor_id = $2', t) using p_keep, p_drop;
      get diagnostics n = row_count; moved := moved || jsonb_build_object(t || '_receipts', n);
      execute format('update %I.import_gik_receipts set donor_id = $1 where donor_id = $2', t) using p_keep, p_drop;
      execute format('update %I.tracker_lines set donor_id = $1 where donor_id = $2', t) using p_keep, p_drop;
    end if;
  end loop;

  -- Keep what the kept donor lacks.
  update ops.donors set
    email = coalesce(email, drop_row.email),
    phone = coalesce(phone, drop_row.phone),
    tin = coalesce(tin, drop_row.tin),
    salutation = coalesce(salutation, drop_row.salutation)
  where id = p_keep;

  insert into ops.donor_merges (kept_id, dropped_id, dropped, moved, reason, merged_by)
  values (p_keep, p_drop, to_jsonb(drop_row), moved, btrim(p_reason), auth.uid());
  update ops.donor_suggestions set status = 'applied', decided_by = auth.uid(), decided_at = now()
    where status = 'pending' and kind = 'merge' and donor_id = p_keep and proposed ->> 'merge' = p_drop::text;
  delete from ops.donors where id = p_drop;
  return moved;
end;
$$;
revoke all on function ops.merge_donors(uuid, uuid, text) from public, anon;
grant execute on function ops.merge_donors(uuid, uuid, text) to authenticated;

create or replace function ops.apply_donor_suggestion(p_id uuid, p_name text default null, p_salutation text default null, p_type text default null)
returns void language plpgsql security definer
set search_path to 'ops', 'pg_temp' as $$
declare
  s ops.donor_suggestions;
  new_name text;
begin
  if not shared.module_editable('donors') then
    raise exception 'Only donors editors can apply suggestions.' using errcode = '42501';
  end if;
  select * into s from ops.donor_suggestions where id = p_id for update;
  if s.id is null or s.status <> 'pending' then
    raise exception 'This suggestion was already decided.' using errcode = '22023';
  end if;
  if s.kind = 'merge' then
    perform ops.merge_donors(s.donor_id, (s.proposed ->> 'merge')::uuid, coalesce(nullif(s.reason, ''), 'Duplicate donor'));
    return;
  end if;
  -- format / incomplete: the editor's version wins over the suggestion's.
  new_name := btrim(regexp_replace(coalesce(p_name, s.proposed ->> 'name', ''), '\s+', ' ', 'g'));
  if char_length(new_name) < 2 or char_length(new_name) > 200 then
    raise exception 'Enter the donor''s name (2 to 200 characters).' using errcode = '22023';
  end if;
  update ops.donors set
    name = new_name,
    salutation = nullif(btrim(coalesce(p_salutation, s.proposed ->> 'salutation', salutation, '')), ''),
    type = coalesce(p_type, s.proposed ->> 'type', type)
  where id = s.donor_id;
  update ops.donor_suggestions set status = 'applied', decided_by = auth.uid(), decided_at = now()
    where id = p_id;
end;
$$;
revoke all on function ops.apply_donor_suggestion(uuid, text, text, text) from public, anon;
grant execute on function ops.apply_donor_suggestion(uuid, text, text, text) to authenticated;

create or replace function ops.reject_donor_suggestion(p_id uuid, p_note text default null)
returns void language plpgsql security definer
set search_path to 'ops', 'pg_temp' as $$
begin
  if not shared.module_editable('donors') then
    raise exception 'Only donors editors can reject suggestions.' using errcode = '42501';
  end if;
  update ops.donor_suggestions set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = nullif(left(btrim(coalesce(p_note, '')), 500), '')
    where id = p_id and status = 'pending';
  if not found then
    raise exception 'This suggestion was already decided.' using errcode = '22023';
  end if;
end;
$$;
revoke all on function ops.reject_donor_suggestion(uuid, text) from public, anon;
grant execute on function ops.reject_donor_suggestion(uuid, text) to authenticated;

alter publication supabase_realtime add table ops.donor_suggestions;
notify pgrst, 'reload schema';
