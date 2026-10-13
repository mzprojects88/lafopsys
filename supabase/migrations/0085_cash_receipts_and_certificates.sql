-- 0085: cash acknowledgment receipts and donee certificates numbered by the database
-- (Sprint 6, decided by the user 2026-10-13).
--
-- Until now an AR or donee certificate was a row the browser inserted with a number made from
-- the clock (AR-2026-123456), for any donation, with no document behind it. Gifts in kind are
-- receipted by LAF Inventory (its LAF-GIK series); this system receipts CASH gifts and issues
-- the BIR Form 2322 certificate of donation for cash and in-kind gifts alike.
--
--   1. ops.doc_counters + ops.next_doc_number: one gap-free series per prefix and year
--      (LAF-CSH-2026-0001 for cash ARs, DC-2026-0001 for certificates).
--   2. shared.app_settings: the registration line, the foundation's address and TIN, and the
--      staff member who signs certificates (name and position come from their staff record).
--   3. ops.donors.address: BIR 2322 names the donor's address.
--   4. The two document tables record who issued/signed, the amount and the accounting booklet
--      number; the browser may no longer write them (writes go through the functions below).
--   5. ops.issue_cash_ar, ops.advance_ar, ops.request_donee_certificate,
--      ops.advance_donee_certificate: donors editors only; each number is taken once.

-- ---------------------------------------------------------------------
-- 1. Series
-- ---------------------------------------------------------------------
create table ops.doc_counters (
  prefix text not null,
  year integer not null,
  last integer not null default 0,
  primary key (prefix, year)
);
alter table ops.doc_counters enable row level security;
revoke all on ops.doc_counters from public, anon, authenticated;

create or replace function ops.next_doc_number(p_prefix text, p_year integer)
returns text language plpgsql security definer
set search_path to 'ops', 'pg_temp' as $$
declare
  n integer;
begin
  insert into ops.doc_counters as c (prefix, year, last) values (p_prefix, p_year, 1)
  on conflict (prefix, year) do update set last = c.last + 1
  returning last into n;
  return format('%s-%s-%s', p_prefix, p_year, to_char(n, 'FM0000'));
end;
$$;
revoke all on function ops.next_doc_number(text, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. What prints on every document (admins edit these in Settings)
-- ---------------------------------------------------------------------
alter table shared.app_settings
  add column if not exists report_header text not null default 'SEC 2021070019208-08 · BIR TIN 601-322-056-00000 · DSWD Licence DSWD-SB-RL-2026-000131',
  add column if not exists org_address text not null default '',
  add column if not exists org_tin text not null default '601-322-056-00000',
  add column if not exists certificate_signatory_id uuid references shared.staff (id);
comment on column shared.app_settings.report_header is 'Registration line printed under the foundation''s name on receipts and certificates (0085).';
comment on column shared.app_settings.certificate_signatory_id is 'The staff member whose name and position sign donee certificates (0085).';

-- ---------------------------------------------------------------------
-- 3. Donor address (BIR 2322)
-- ---------------------------------------------------------------------
alter table ops.donors
  add column if not exists address text check (address is null or char_length(address) <= 300);

-- ---------------------------------------------------------------------
-- 4. The document rows
-- ---------------------------------------------------------------------
alter table ops.acknowledgment_receipts
  add column if not exists issued_by uuid references shared.staff (id),
  add column if not exists booklet_number text,
  add column if not exists amount numeric(12, 2),
  add column if not exists currency text check (currency in ('USD', 'PHP'));
comment on column ops.acknowledgment_receipts.booklet_number is 'Accounting''s paper AR / service invoice number for the gift, printed as reference (0085).';

alter table ops.donee_certificates
  add column if not exists kind text check (kind in ('cash', 'in_kind')),
  add column if not exists amount numeric(12, 2),
  add column if not exists description text,
  add column if not exists signatory_id uuid references shared.staff (id),
  add column if not exists released_by uuid references shared.staff (id);

-- Numbers come from the series only: the browser reads these tables (module read, donor
-- read-own) and never writes them.
revoke insert, update, delete on ops.acknowledgment_receipts, ops.donee_certificates from authenticated;
-- The clock-numbered rows the old button made (AR-2026-…, two on anonymous gifts in kind) were
-- never printed and are not in any series: gone, so the registers start clean.
delete from ops.acknowledgment_receipts where sequence_number like 'AR-%';
delete from ops.donee_certificates where control_number like 'DC-____-______';

-- ---------------------------------------------------------------------
-- 5. Issuing and advancing
-- ---------------------------------------------------------------------
create or replace function ops.issue_cash_ar(p_donation uuid)
returns text language plpgsql security definer
set search_path to 'ops', 'pg_temp' as $$
declare
  d ops.donations%rowtype;
  v_type text;
  v_number text;
begin
  if not shared.module_editable('donors') then
    raise exception 'Only donors editors issue acknowledgment receipts.' using errcode = '42501';
  end if;
  select * into d from ops.donations where id = p_donation for update;
  if not found then
    raise exception 'Donation not found.' using errcode = 'P0002';
  end if;
  if d.kind <> 'cash' then
    raise exception 'Gifts in kind are receipted in LAF Inventory.' using errcode = '22023';
  end if;
  select type into v_type from ops.donors where id = d.donor_id;
  if v_type is null or v_type = 'anonymous' then
    raise exception 'Set the donor first: an AR names who gave.' using errcode = '22023';
  end if;
  if exists (select 1 from ops.acknowledgment_receipts where donation_id = d.id) then
    raise exception 'This gift already has an acknowledgment receipt.' using errcode = '22023';
  end if;
  v_number := ops.next_doc_number('LAF-CSH', extract(year from d.date)::integer);
  insert into ops.acknowledgment_receipts (donation_id, sequence_number, entity, status, issued_at, issued_by, booklet_number, amount, currency)
  values (d.id, v_number, d.receiving_entity, 'issued', now(), auth.uid(), nullif(btrim(d.invoice_number), ''), d.total_value, d.currency);
  return v_number;
end;
$$;
revoke all on function ops.issue_cash_ar(uuid) from public, anon;
grant execute on function ops.issue_cash_ar(uuid) to authenticated;

create or replace function ops.advance_ar(p_id uuid)
returns text language plpgsql security definer
set search_path to 'ops', 'pg_temp' as $$
declare
  v_status text;
  v_next text;
begin
  if not shared.module_editable('donors') then
    raise exception 'Only donors editors update acknowledgment receipts.' using errcode = '42501';
  end if;
  select status into v_status from ops.acknowledgment_receipts where id = p_id for update;
  if not found then
    raise exception 'Receipt not found.' using errcode = 'P0002';
  end if;
  v_next := case v_status when 'draft' then 'issued' when 'issued' then 'sent' when 'sent' then 'acknowledged' end;
  if v_next is null then
    raise exception 'This receipt is already acknowledged.' using errcode = '22023';
  end if;
  update ops.acknowledgment_receipts set
    status = v_next,
    issued_at = case when v_next = 'issued' then now() else issued_at end,
    sent_at = case when v_next = 'sent' then now() else sent_at end,
    acknowledged_at = case when v_next = 'acknowledged' then now() else acknowledged_at end
  where id = p_id;
  return v_next;
end;
$$;
revoke all on function ops.advance_ar(uuid) from public, anon;
grant execute on function ops.advance_ar(uuid) to authenticated;

create or replace function ops.request_donee_certificate(p_donation uuid)
returns text language plpgsql security definer
set search_path to 'ops', 'pg_temp' as $$
declare
  d ops.donations%rowtype;
  v_type text;
  v_number text;
begin
  if not shared.module_editable('donors') then
    raise exception 'Only donors editors request donee certificates.' using errcode = '42501';
  end if;
  select * into d from ops.donations where id = p_donation for update;
  if not found then
    raise exception 'Donation not found.' using errcode = 'P0002';
  end if;
  select type into v_type from ops.donors where id = d.donor_id;
  if v_type is null or v_type = 'anonymous' then
    raise exception 'Set the donor first: a certificate names who gave.' using errcode = '22023';
  end if;
  if exists (select 1 from ops.donee_certificates where donation_id = d.id) then
    raise exception 'This gift already has a donee certificate.' using errcode = '22023';
  end if;
  v_number := ops.next_doc_number('DC', extract(year from d.date)::integer);
  insert into ops.donee_certificates (donation_id, control_number, status, requested_at, kind, amount, description, signatory_id)
  values (d.id, v_number, 'requested', now(), d.kind, d.total_value, nullif(btrim(d.item_description), ''),
          (select certificate_signatory_id from shared.app_settings where id));
  return v_number;
end;
$$;
revoke all on function ops.request_donee_certificate(uuid) from public, anon;
grant execute on function ops.request_donee_certificate(uuid) to authenticated;

create or replace function ops.advance_donee_certificate(p_id uuid)
returns text language plpgsql security definer
set search_path to 'ops', 'pg_temp' as $$
declare
  v_status text;
  v_next text;
begin
  if not shared.module_editable('donors') then
    raise exception 'Only donors editors update donee certificates.' using errcode = '42501';
  end if;
  select status into v_status from ops.donee_certificates where id = p_id for update;
  if not found then
    raise exception 'Certificate not found.' using errcode = 'P0002';
  end if;
  v_next := case v_status when 'requested' then 'prepared' when 'prepared' then 'approved' when 'approved' then 'released' when 'released' then 'filed' end;
  if v_next is null then
    raise exception 'This certificate is already filed.' using errcode = '22023';
  end if;
  update ops.donee_certificates set
    status = v_next,
    released_at = case when v_next = 'released' then now() else released_at end,
    released_by = case when v_next = 'released' then auth.uid() else released_by end,
    -- The signatory is fixed when the certificate is released, so a later change in Settings doesn't reword a released document.
    signatory_id = case when v_next = 'released' then coalesce(signatory_id, (select certificate_signatory_id from shared.app_settings where id)) else signatory_id end
  where id = p_id;
  return v_next;
end;
$$;
revoke all on function ops.advance_donee_certificate(uuid) from public, anon;
grant execute on function ops.advance_donee_certificate(uuid) to authenticated;

notify pgrst, 'reload schema';
