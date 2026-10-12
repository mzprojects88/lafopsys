-- 0084: cash gifts from accounting's sheets (Sprint 6, decided by the user 2026-10-08/12).
--
-- Until now ops.donations held gifts in kind only. Cash was only on accounting's sheets: the
-- 2024 and 2025 transaction reports and the day-to-day "2026 LAF Donation Tracker" (CASH tab).
-- Decided: gifts in kind are recorded in LAF Inventory and nowhere else (it posts each receipt
-- here); cash comes from accounting's sheets, which stay the record for cash. Nothing joins the
-- donor list on its own: a donors editor confirms each sheet NAME once (an existing donor, a new
-- donor, or "not a donor"); that name's gifts then post now and at every later read.
--
--   1. ops.donations: payment_method, invoice_number, notes. Inventory roles may add gifts in
--      kind only.
--   2. ops.donor_name_key: the same donor however the name was typed.
--   3. ops.cash_gift_lines: the sheets' lines as last read (replaced whole per sheet), and
--      ops.cash_gift_sources: when each sheet was last read and the rows that couldn't be.
--   4. ops.donor_sheet_names: the decision per name. ops.sheet_name_hints: the AI's reading of
--      a name (which type of donor), a hint for the editor.
--   5. ops.receive_cash_lines (the server only), ops.decide_sheet_names (donors editors) and
--      the internal ops.post_cash_gifts, which makes the posted gifts equal the confirmed lines.
--   6. ops.merge_donors also moves a merged donor's sheet names.
--   7. One-time: 11 LAF Inventory receipts of 5-22 Aug 2026 (imported history) never reached
--      this register; they are added, linked to their receipt.

-- ---------------------------------------------------------------------
-- 1. What a cash gift carries
-- ---------------------------------------------------------------------
alter table ops.donations
  add column if not exists payment_method text check (payment_method in ('cash', 'check', 'bank_transfer', 'gcash', 'instapay', 'other')),
  add column if not exists invoice_number text check (invoice_number is null or char_length(invoice_number) <= 60),
  add column if not exists notes text check (notes is null or char_length(notes) <= 500);
alter table ops.donations drop constraint if exists donations_payment_method_is_cash;
alter table ops.donations add constraint donations_payment_method_is_cash check (payment_method is null or kind = 'cash');

-- Inventory roles record gifts in kind, never cash: their insert-only door (0016, 0073) now says
-- so. LAF Inventory always sends kind = 'in_kind', so nothing it does changes. (Donors editors
-- keep their own policy: an admin receiving in LAF Inventory posts through it.)
drop policy "inventory roles insert donations" on ops.donations;
create policy "inventory roles insert donations" on ops.donations for insert to authenticated
  with check (shared.has_role('chef', 'inventory_staff', 'nutritionist', 'inventory_lead') and kind = 'in_kind');

-- ---------------------------------------------------------------------
-- 2. One key per donor name: capitals, accents, punctuation, titles, one-letter initials and
--    word order ignored. Same result as wordKey() in lib/utils/donor-details.ts (both are pinned
--    by tests); a name with nothing left ("A B") keeps its letters, one with no letters is 'unnamed'.
-- ---------------------------------------------------------------------
create or replace function ops.donor_name_key(p_name text)
returns text language sql immutable
set search_path to 'pg_catalog' as $$
  with n as (
    select btrim(regexp_replace(regexp_replace(regexp_replace(
      lower(normalize(coalesce(p_name, ''), NFD)), '[̀-ͯ]', '', 'g'),
      '\m(mr|mrs|ms|miss|dr|engr|atty|hon)\M\.?', ' ', 'g'),
      '[^a-z0-9]+', ' ', 'g')) as s
  )
  select coalesce(
    (select string_agg(w, ' ' order by w collate "C") from regexp_split_to_table((select s from n), ' ') as w where char_length(w) > 1),
    nullif((select s from n), ''),
    'unnamed');
$$;

-- ---------------------------------------------------------------------
-- 3. The sheets' lines, as last read
-- ---------------------------------------------------------------------
create table ops.cash_gift_lines (
  source text not null check (source in ('2024', '2025', '2025_noncash', '2026')),
  -- date|name key|amount|method|invoice#n: a line that changes on the sheet is a new line.
  line_key text not null,
  sheet_row integer not null,
  date date not null,
  donor_name text not null check (btrim(donor_name) <> '' and char_length(donor_name) <= 200),
  name_key text not null check (name_key <> ''),
  kind text not null default 'cash' check (kind in ('cash', 'in_kind')),
  payment_method text check (payment_method in ('cash', 'check', 'bank_transfer', 'gcash', 'instapay', 'other')),
  amount numeric(12, 2) not null check (amount > 0),
  invoice_number text check (invoice_number is null or char_length(invoice_number) <= 60),
  notes text check (notes is null or char_length(notes) <= 500),
  primary key (source, line_key),
  check (payment_method is null or kind = 'cash')
);
create index cash_gift_lines_name_key on ops.cash_gift_lines (name_key);

create table ops.cash_gift_sources (
  source text primary key check (source in ('2024', '2025', '2025_noncash', '2026')),
  received_at timestamptz not null default now(),
  changed_at timestamptz not null default now(),
  lines integer not null,
  content_hash text,
  -- Rows the reader could not use ("row 25: the date 210/2026 can't be read"), shown to staff.
  problems jsonb not null default '[]'::jsonb
);

-- ---------------------------------------------------------------------
-- 4. The decision per name. donor_id null = "not a donor": its lines are never posted.
-- ---------------------------------------------------------------------
create table ops.donor_sheet_names (
  name_key text primary key check (name_key <> ''),
  sheet_name text not null,
  donor_id uuid references ops.donors (id) on delete cascade,
  decided_by uuid,
  decided_at timestamptz not null default now()
);
create index donor_sheet_names_donor on ops.donor_sheet_names (donor_id);

-- What the AI reads a sheet name as (which type of donor; only a first name?). A hint shown to
-- the editor confirming the name, never a decision: the rules write the name, a clear word in it
-- outranks the hint, and the editor can change the type. Written once per name, by an editor's
-- "Check names with AI" (as that editor); never updated.
create table ops.sheet_name_hints (
  name_key text primary key check (name_key <> ''),
  type text not null check (type in ('individual', 'corporate', 'foundation', 'government', 'anonymous')),
  incomplete boolean not null default false,
  note text not null default '' check (char_length(note) <= 300),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

alter table ops.cash_gift_lines enable row level security;
alter table ops.cash_gift_sources enable row level security;
alter table ops.donor_sheet_names enable row level security;
alter table ops.sheet_name_hints enable row level security;
revoke all on ops.cash_gift_lines, ops.cash_gift_sources, ops.donor_sheet_names, ops.sheet_name_hints from public, anon, authenticated;
grant select on ops.cash_gift_lines, ops.cash_gift_sources, ops.donor_sheet_names to authenticated;
grant select, insert on ops.sheet_name_hints to authenticated;
create policy "donors viewers read" on ops.sheet_name_hints for select to authenticated
  using ((select shared.module_viewable('donors')));
create policy "donors editors add hints" on ops.sheet_name_hints for insert to authenticated
  with check ((select shared.module_editable('donors')));
create policy "donors viewers read" on ops.cash_gift_lines for select to authenticated
  using ((select shared.module_viewable('donors')));
create policy "donors viewers read" on ops.cash_gift_sources for select to authenticated
  using ((select shared.module_viewable('donors')));
create policy "donors viewers read" on ops.donor_sheet_names for select to authenticated
  using ((select shared.module_viewable('donors')));

-- ---------------------------------------------------------------------
-- 5. Posting. A posted gift is ops.donations with source_id 'sheet:<source>:<line key>'.
-- ---------------------------------------------------------------------

-- Makes the posted gifts equal the confirmed lines. Internal: called by the two functions below.
create or replace function ops.post_cash_gifts()
returns integer language plpgsql security definer
set search_path to 'ops', 'pg_temp' as $$
declare
  n integer;
begin
  -- A gift whose line left the sheet, changed (a changed line has a new key) or whose name is no
  -- longer a donor goes -- unless a receipt or certificate was issued on it; then a person decides.
  delete from ops.donations d
  where d.source_id like 'sheet:%'
    and not exists (
      select 1 from ops.cash_gift_lines l join ops.donor_sheet_names s on s.name_key = l.name_key and s.donor_id is not null
      where 'sheet:' || l.source || ':' || l.line_key = d.source_id)
    and not exists (select 1 from ops.acknowledgment_receipts a where a.donation_id = d.id)
    and not exists (select 1 from ops.donee_certificates c where c.donation_id = d.id);

  -- A name decided again (or a merged donor): its gifts follow.
  update ops.donations d set donor_id = s.donor_id
  from ops.cash_gift_lines l join ops.donor_sheet_names s on s.name_key = l.name_key and s.donor_id is not null
  where d.source_id = 'sheet:' || l.source || ':' || l.line_key and d.donor_id <> s.donor_id;

  insert into ops.donations (donor_id, date, receiving_entity, kind, item_description, total_value, currency, status, source_id, payment_method, invoice_number, notes)
  select s.donor_id, l.date, 'PH_SEC', l.kind, case when l.kind = 'in_kind' then l.notes end, l.amount, 'PHP', 'finalized',
         'sheet:' || l.source || ':' || l.line_key, l.payment_method, l.invoice_number, case when l.kind = 'cash' then l.notes end
  from ops.cash_gift_lines l join ops.donor_sheet_names s on s.name_key = l.name_key and s.donor_id is not null
  where not exists (select 1 from ops.donations d where d.source_id = 'sheet:' || l.source || ':' || l.line_key);
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function ops.post_cash_gifts() from public, anon, authenticated;

-- One read of one sheet replaces the last, whole. Called by the server with the service role
-- (LAF Inventory's /api/programs/tracker-sync for 2026, scripts/import-cash-reports.mjs for the
-- reports). A read that lost more than half its lines is refused: a moved column or an emptied
-- tab must not remove gifts.
create or replace function ops.receive_cash_lines(p_source text, p_lines jsonb, p_problems jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer
set search_path to 'ops', 'pg_temp' as $$
declare
  had integer;
  n integer;
  v_hash text;
  posted integer := 0;
begin
  if p_source is null or p_source not in ('2024', '2025', '2025_noncash', '2026') then
    raise exception 'Unknown sheet.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_typeof(p_problems) is distinct from 'array' then
    raise exception 'Expected a list of lines.' using errcode = '22023';
  end if;
  -- One read or decision at a time: two at once could post the same line twice.
  perform pg_advisory_xact_lock(840084);
  n := jsonb_array_length(p_lines);
  select count(*) into had from ops.cash_gift_lines where source = p_source;
  if n = 0 or n > 20000 or n < had / 2.0 then
    raise exception 'Only % readable lines (the last read had %); nothing changed.', n, had using errcode = '22023';
  end if;

  v_hash := md5(p_lines::text);
  if exists (select 1 from ops.cash_gift_sources where source = p_source and content_hash = v_hash) then
    update ops.cash_gift_sources set received_at = now(), problems = p_problems where source = p_source;
    return jsonb_build_object('status', 'unchanged', 'lines', n);
  end if;

  delete from ops.cash_gift_lines where source = p_source;
  insert into ops.cash_gift_lines (source, line_key, sheet_row, date, donor_name, name_key, kind, payment_method, amount, invoice_number, notes)
  select p_source,
         k.base || '#' || row_number() over (partition by k.base order by x.sheet_row),
         x.sheet_row, x.date, left(btrim(x.donor_name), 200), k.name_key, coalesce(x.kind, 'cash'), x.payment_method, x.amount::numeric(12, 2),
         nullif(left(btrim(x.invoice_number), 60), ''), nullif(left(btrim(x.notes), 500), '')
  from jsonb_to_recordset(p_lines) as x(sheet_row integer, date date, donor_name text, kind text, payment_method text, amount numeric, invoice_number text, notes text)
  cross join lateral (
    select ops.donor_name_key(x.donor_name) as name_key,
           concat_ws('|', to_char(x.date, 'YYYY-MM-DD'), ops.donor_name_key(x.donor_name), (x.amount::numeric(12, 2))::text, coalesce(x.payment_method, ''), coalesce(btrim(x.invoice_number), '')) as base
  ) k;

  insert into ops.cash_gift_sources (source, received_at, changed_at, lines, content_hash, problems)
  values (p_source, now(), now(), n, v_hash, p_problems)
  on conflict (source) do update set received_at = now(), changed_at = now(), lines = excluded.lines, content_hash = excluded.content_hash, problems = excluded.problems;

  posted := ops.post_cash_gifts();
  return jsonb_build_object('status', 'received', 'lines', n, 'posted', posted);
end;
$$;
revoke all on function ops.receive_cash_lines(text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function ops.receive_cash_lines(text, jsonb, jsonb) to service_role;

-- A donors editor decides names: [{name_key, donor_id}] an existing donor, [{name_key, name,
-- salutation, type}] a new donor, [{name_key, skip: true}] not a donor. Their gifts post at once.
create or replace function ops.decide_sheet_names(p_decisions jsonb)
returns integer language plpgsql security definer
set search_path to 'ops', 'pg_temp' as $$
declare
  d record;
  v_sheet_name text;
  v_donor uuid;
  v_name text;
begin
  if not shared.module_editable('donors') then
    raise exception 'Only donors editors can confirm names.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_decisions) is distinct from 'array' or jsonb_array_length(p_decisions) not between 1 and 500 then
    raise exception 'Expected 1 to 500 decisions.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(840084);
  for d in select * from jsonb_to_recordset(p_decisions) as x(name_key text, donor_id uuid, name text, salutation text, type text, skip boolean) loop
    select min(l.donor_name) into v_sheet_name from ops.cash_gift_lines l where l.name_key = d.name_key;
    if v_sheet_name is null then
      raise exception 'That name is not on the sheets any more.' using errcode = '22023';
    end if;
    if coalesce(d.skip, false) then
      v_donor := null;
    elsif d.donor_id is not null then
      select id into v_donor from ops.donors where id = d.donor_id;
      if v_donor is null then
        raise exception 'That donor no longer exists.' using errcode = '22023';
      end if;
    elsif exists (select 1 from ops.donor_sheet_names s where s.name_key = d.name_key and s.donor_id is not null) then
      continue; -- a second click on "new donor": the donor was already made
    else
      v_name := btrim(regexp_replace(coalesce(d.name, ''), '\s+', ' ', 'g'));
      if char_length(v_name) not between 2 and 200 then
        raise exception 'Enter the donor''s name (2 to 200 characters).' using errcode = '22023';
      end if;
      if d.type is null or d.type not in ('individual', 'corporate', 'foundation', 'government', 'anonymous') then
        raise exception 'Choose the donor type.' using errcode = '22023';
      end if;
      insert into ops.donors (name, salutation, type, tax_jurisdiction)
      values (v_name, nullif(left(btrim(coalesce(d.salutation, '')), 20), ''), d.type, 'PH')
      returning id into v_donor;
    end if;
    insert into ops.donor_sheet_names (name_key, sheet_name, donor_id, decided_by)
    values (d.name_key, v_sheet_name, v_donor, auth.uid())
    on conflict (name_key) do update set sheet_name = excluded.sheet_name, donor_id = excluded.donor_id, decided_by = excluded.decided_by, decided_at = now();
  end loop;
  return ops.post_cash_gifts();
end;
$$;
revoke all on function ops.decide_sheet_names(jsonb) from public, anon;
grant execute on function ops.decide_sheet_names(jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 6. A merge moves the merged donor's sheet names too (otherwise its cash gifts would be
--    removed at the next read and wait for a new decision). 0083's function, one line added.
-- ---------------------------------------------------------------------
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
  update ops.donor_sheet_names set donor_id = p_keep where donor_id = p_drop; get diagnostics n = row_count; moved := moved || jsonb_build_object('sheet_names', n);
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

-- ---------------------------------------------------------------------
-- 7. The August gap. LAF Inventory's history import (its 0046) wrote receipts 0167-0179 of
--    5-22 Aug 2026 to inventory.donation_log only; the register's own import ended on 1 Aug.
--    They are history taken from the tracker, so 'finalized' like January to July. Linked by
--    source_id = the receipt, which is how Inventory finds its register row (its 0053).
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('inventory.donation_log') is not null then
    insert into ops.donations (donor_id, date, receiving_entity, kind, item_description, total_value, currency, status, source_id)
    select r.donor_id, r.date, case when d.tax_jurisdiction = 'US' then 'US_501C3' else 'PH_SEC' end, 'in_kind', r.item_summary, coalesce(r.valuation_total, 0),
           case when d.tax_jurisdiction = 'US' then 'USD' else 'PHP' end, 'finalized', r.id
    from inventory.donation_log r join ops.donors d on d.id = r.donor_id
    where r.import_batch_id is not null and r.date between '2026-08-02' and '2026-08-22'
      and not exists (select 1 from ops.donations x where x.source_id = r.id)
      and not exists (select 1 from ops.donations x where x.donor_id = r.donor_id and x.date = r.date);
  end if;
end;
$$;

alter publication supabase_realtime add table ops.cash_gift_lines, ops.cash_gift_sources, ops.donor_sheet_names, ops.sheet_name_hints;
notify pgrst, 'reload schema';
