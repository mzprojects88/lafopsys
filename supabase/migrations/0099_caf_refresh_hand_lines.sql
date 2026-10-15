-- NCH billing (0098) follow-up, 2026-10-15: a line changed by hand kept its nights on refresh and
-- never gained the nights recorded after the change -- so a child given 1-12 Oct from the House
-- Sheet on the 16th would be billed without 13-31 Oct. Now a hand-changed line keeps what the editor
-- set and gains only nights confirmed after that change (a night the editor removed stays removed,
-- unless that same night is confirmed again later).
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
  -- Hand-changed lines gain the nights confirmed since the change.
  update ops.caf_billing_lines l
     set nights = (select array_agg(distinct n order by n) from unnest(l.nights || newer.nights) n)
    from (
      select l2.patient_id, array_agg(bn.night) as nights
        from ops.caf_billing_lines l2
        join ops.stays s on s.patient_id = l2.patient_id
        join ops.bed_nights bn on bn.stay_id = s.id
       where l2.billing_id = v_bill.id and l2.manual_reason is not null
         and bn.night between v_month and v_end
         and bn.confirmed_at > l2.changed_at
         and bn.night <> all (l2.nights)
       group by l2.patient_id
    ) newer
   where l.billing_id = v_bill.id and l.patient_id = newer.patient_id;
  insert into ops.caf_billing_lines (billing_id, patient_id, nights, pwd, changed_by)
  select v_bill.id, s.patient_id, array_agg(distinct bn.night order by bn.night), bool_or(p.pwd), auth.uid()
    from ops.bed_nights bn
    join ops.stays s on s.id = bn.stay_id
    join ops.patients p on p.id = s.patient_id
   where bn.night between v_month and v_end and p.caf_billing
   group by s.patient_id
  on conflict (billing_id, patient_id) do nothing;
  -- PWD as the record says today, for every line of a draft.
  update ops.caf_billing_lines l set pwd = p.pwd from ops.patients p where l.billing_id = v_bill.id and p.id = l.patient_id;
  return v_bill.id;
end;
$$;

notify pgrst, 'reload schema';
