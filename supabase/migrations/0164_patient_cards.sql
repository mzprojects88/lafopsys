-- 0164: Patient ID cards with a QR code (owner, 18 Nov 2026), phase 1: issue, replace, switch off.
--
-- One card per child at a time. The QR on the card holds https://arkos.littlearkfoundation.org/c/<token>:
-- the token is random (gen_random_uuid without dashes, 122 random bits), never the case number, so a
-- card cannot be guessed from another. It is read only by staff who may see Patients (RLS below);
-- phase 2 adds the /c/<token> page and the scan log. Issuing a new card ends the one before
-- ("replaced"); a lost card can also be switched off on its own, with a reason.
--
-- Writes go through the two functions (Patients editors); nobody writes the table directly.
-- No rows are inserted here.

create table if not exists ops.patient_cards (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references ops.patients (id) on delete cascade deferrable initially immediate,
  token text not null unique check (token ~ '^[0-9a-f]{32}$'),
  version integer not null check (version >= 1),
  status text not null default 'active' check (status in ('active', 'replaced', 'switched_off')),
  issued_at timestamptz not null default now(),
  issued_by uuid default auth.uid(),
  ended_at timestamptz,
  ended_by uuid,
  ended_reason text check (ended_reason is null or char_length(ended_reason) <= 300),
  unique (patient_id, version),
  check ((status = 'active') = (ended_at is null))
);
create unique index if not exists patient_cards_one_active on ops.patient_cards (patient_id) where status = 'active';

alter table ops.patient_cards enable row level security;
drop policy if exists "patients viewers read cards" on ops.patient_cards;
create policy "patients viewers read cards" on ops.patient_cards for select to authenticated
  using (shared.module_viewable('patients'));
revoke all on ops.patient_cards from anon, authenticated;
grant select on ops.patient_cards to authenticated;

-- Issue a card, or a new one for a lost or damaged card: the active card (if any) is replaced.
create or replace function ops.issue_patient_card(p_patient_id uuid, p_reason text default null)
returns ops.patient_cards
language plpgsql security definer set search_path to '' as $$
declare
  v_card ops.patient_cards;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if not shared.module_editable('patients') then
    raise exception 'Your access to Patients is view only' using errcode = '42501';
  end if;
  perform 1 from ops.patients where id = p_patient_id for update;
  if not found then
    raise exception 'Patient not found' using errcode = 'P0002';
  end if;
  if v_reason is not null and char_length(v_reason) > 300 then
    raise exception 'Keep the reason under 300 characters' using errcode = '22023';
  end if;
  update ops.patient_cards
     set status = 'replaced', ended_at = now(), ended_by = auth.uid(), ended_reason = coalesce(v_reason, 'A new card was printed')
   where patient_id = p_patient_id and status = 'active';
  insert into ops.patient_cards (patient_id, token, version)
    values (p_patient_id, replace(gen_random_uuid()::text, '-', ''),
            coalesce((select max(c.version) from ops.patient_cards c where c.patient_id = p_patient_id), 0) + 1)
    returning * into v_card;
  return v_card;
end;
$$;

-- Switch a card off (lost, family left) without printing a new one: a reason is required.
create or replace function ops.switch_off_patient_card(p_card_id uuid, p_reason text)
returns ops.patient_cards
language plpgsql security definer set search_path to '' as $$
declare
  v_card ops.patient_cards;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if not shared.module_editable('patients') then
    raise exception 'Your access to Patients is view only' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'Say why the card is switched off' using errcode = '22023';
  end if;
  if char_length(v_reason) > 300 then
    raise exception 'Keep the reason under 300 characters' using errcode = '22023';
  end if;
  update ops.patient_cards
     set status = 'switched_off', ended_at = now(), ended_by = auth.uid(), ended_reason = v_reason
   where id = p_card_id and status = 'active'
   returning * into v_card;
  if v_card.id is null then
    raise exception 'That card is not active' using errcode = 'P0002';
  end if;
  return v_card;
end;
$$;

revoke all on function ops.issue_patient_card(uuid, text), ops.switch_off_patient_card(uuid, text) from public, anon;
grant execute on function ops.issue_patient_card(uuid, text), ops.switch_off_patient_card(uuid, text) to authenticated;

-- Live updates in ArkOS.
do $$
begin
  alter publication supabase_realtime add table ops.patient_cards;
exception when duplicate_object then null;
end $$;

notify pgrst, 'reload schema';
