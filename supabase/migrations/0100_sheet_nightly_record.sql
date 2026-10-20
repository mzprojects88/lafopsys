-- 0100: the House Sheet is the nightly record (user, 2026-10-20).
--
-- The app had no nights for 13, 17 and 18 Oct while the House Sheet listed 11, 13 and 13
-- families: nobody checked in through the app that weekend. The user's rule: the sheet is the
-- source of truth until it is switched off in Settings.
--
--   1. ops.sheet_nights: every daily tab's roster, one row per name per night (the tab's date is
--      the night slept at LAF), written only by the House Sheet sync with the service role.
--   2. shared.app_settings.nights_from_app_since: null = the sheet is the record; a date = the
--      app's own nights from that night on (earlier nights stay from the sheet).
--   3. ops.nightly_record: who stayed each night, from whichever is the record. A sheet name
--      counts once it is matched to a child (rules, confirmed, or admitted from the sheet; an AI
--      suggestion only after it is confirmed), so confirming later fixes the past nights too. A
--      night with no sheet rows at all falls back to the app's. The app's bed rides along.
--   4. ops.caf_draft reads ops.nightly_record (replaces 0099's bed_nights reads).

-- ---- 1. the sheet's nights ----
create table ops.sheet_nights (
  night date not null,
  name_key text not null,
  patient_name text not null,
  carer_name text,
  relationship text,
  next_appointment_raw text,
  treatment text,
  address text,
  phone text,
  row_no integer,
  first_synced_at timestamptz not null default now(),
  synced_at timestamptz not null default now(),
  primary key (night, name_key)
);
create index sheet_nights_name_idx on ops.sheet_nights (name_key);

alter table ops.sheet_nights enable row level security;
create policy "patients viewers read the sheet nights" on ops.sheet_nights
  for select to authenticated
  using ((select shared.module_viewable(variadic array['patients'])));
-- No write policy: only the sync, with the service role, writes rows.
revoke insert, update, delete on ops.sheet_nights from authenticated;
grant select on ops.sheet_nights to authenticated;

alter table ops.house_sheet_sync_runs add column nights_saved integer;

-- ---- 2. the switch ----
alter table shared.app_settings add column nights_from_app_since date;

-- ---- 3. who stayed each night ----
create view ops.nightly_record with (security_invoker = true) as
with cut as (
  select coalesce((select nights_from_app_since from shared.app_settings where id), 'infinity'::date) as since
),
sheet as (
  select distinct on (h.matched_patient_id, sn.night)
         h.matched_patient_id as patient_id, sn.night, sn.first_synced_at as recorded_at, sn.carer_name
    from ops.sheet_nights sn
    join ops.house_sheet_people h on h.name_key = sn.name_key
   where h.match_status in ('auto_matched', 'confirmed', 'encoded') and h.matched_patient_id is not null
     and sn.night < (select since from cut)
   order by h.matched_patient_id, sn.night, sn.first_synced_at
),
sheet_runs as (
  -- A visit on the sheet: nights in a row.
  select s.*, s.night - (row_number() over (partition by s.patient_id order by s.night))::int as run
    from sheet s
),
app as (
  select distinct on (st.patient_id, bn.night)
         st.patient_id, bn.night, bn.confirmed_at as recorded_at, bn.bed_position_id, coalesce(st.visit_id, st.id) as visit_id,
         (select c.name from ops.carers c where c.id = st.carer_id) as carer_name
    from ops.bed_nights bn
    join ops.stays st on st.id = bn.stay_id
   order by st.patient_id, bn.night, bn.confirmed_at
)
select r.patient_id, r.night, 'sheet'::text as source, r.recorded_at, a.bed_position_id, r.carer_name,
       r.patient_id::text || ':' || r.run::text as visit_key,
       min(r.night) over (partition by r.patient_id, r.run) as visit_start
  from sheet_runs r
  left join app a on a.patient_id = r.patient_id and a.night = r.night
union all
select a.patient_id, a.night, 'app', a.recorded_at, a.bed_position_id, a.carer_name,
       a.visit_id::text,
       (select min(s2.check_in_at) from ops.stays s2 where coalesce(s2.visit_id, s2.id) = a.visit_id)
  from app a
 where a.night >= (select since from cut)
    or not exists (select 1 from ops.sheet_nights x where x.night = a.night);

-- Read as the viewer: a House Ops-only viewer (driver, house staff) sees no sheet_nights, so the
-- fallback shows them every app night. Pages that read this view are for Patients viewers.
grant select on ops.nightly_record to authenticated;

-- ---- 4. NCH billing from the nightly record ----
create or replace function ops.caf_draft(p_month date)
returns uuid
language plpgsql security definer set search_path = ops, shared, pg_temp as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_end date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_caf jsonb := (select caf from shared.app_settings where id = true);
  v_bill ops.caf_billings%rowtype;
begin
  perform ops.caf_require('caf_billing');
  if p_month is null then
    raise exception 'Choose the month' using errcode = '22023';
  end if;
  select * into v_bill from ops.caf_billings where month = v_month for update;
  if v_bill.id is not null and v_bill.status <> 'draft' then
    raise exception 'This month''s bill is final; the Super Admin can reopen it' using errcode = '42501';
  end if;
  if v_bill.id is null then
    insert into ops.caf_billings (month, rate, cap, discount_pct, created_by)
    values (v_month, (v_caf->>'rate')::numeric, (v_caf->>'cap')::int, (v_caf->>'discount_pct')::numeric, auth.uid())
    returning * into v_bill;
  else
    -- A draft follows today's figures.
    update ops.caf_billings set rate = (v_caf->>'rate')::numeric, cap = (v_caf->>'cap')::int,
           discount_pct = (v_caf->>'discount_pct')::numeric, updated_at = now()
     where id = v_bill.id;
  end if;

  delete from ops.caf_billing_lines where billing_id = v_bill.id and manual_reason is null;
  -- Hand-changed lines gain the nights recorded since the change (a night removed by hand stays removed).
  update ops.caf_billing_lines l
     set nights = (select array_agg(distinct n order by n) from unnest(l.nights || newer.nights) n)
    from (
      select l2.patient_id, array_agg(r.night) as nights
        from ops.caf_billing_lines l2
        join ops.nightly_record r on r.patient_id = l2.patient_id
       where l2.billing_id = v_bill.id and l2.manual_reason is not null
         and r.night between v_month and v_end
         and r.recorded_at > l2.changed_at
         and r.night <> all (l2.nights)
       group by l2.patient_id
    ) newer
   where l.billing_id = v_bill.id and l.patient_id = newer.patient_id;
  insert into ops.caf_billing_lines (billing_id, patient_id, nights, pwd, changed_by)
  select v_bill.id, r.patient_id, array_agg(distinct r.night order by r.night), bool_or(p.pwd), auth.uid()
    from ops.nightly_record r
    join ops.patients p on p.id = r.patient_id
   where r.night between v_month and v_end and p.caf_billing
   group by r.patient_id
  on conflict (billing_id, patient_id) do nothing;
  -- PWD as the record says today, for every line of a draft.
  update ops.caf_billing_lines l set pwd = p.pwd from ops.patients p where l.billing_id = v_bill.id and p.id = l.patient_id;
  return v_bill.id;
end;
$$;

notify pgrst, 'reload schema';
