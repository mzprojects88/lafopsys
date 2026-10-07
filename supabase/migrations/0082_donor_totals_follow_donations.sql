-- 0082: a donor's totals always match their donations; donation history can't be deleted with
-- the donor (Sprint 6, "Donor list & donor file", 2026-10-07).
--
-- ops.donors.gift_count / lifetime_value / first_gift_date / last_gift_date were stored rollups
-- kept up to date only by lafopsys' own "New Donation" (in the browser, two separate writes). The
-- in-kind donations LAF Inventory records never touched them, so on 2026-10-07 19 donors had the
-- wrong count and value and 165 the wrong last-gift date. The donor list, donor file, Analytics,
-- the VIP portal and the VIP rule (3+ gifts) all read them.
--
--   1. ops.keep_donor_totals: BEFORE INSERT/UPDATE OF those four columns on ops.donors, they are
--      set from ops.donations -- whatever the caller sent. A stale or wrong value can't be written.
--   2. ops.donations_touch_donor: AFTER a donation is added, changed (donor, value, date) or
--      removed, the donor(s) concerned are recomputed. SECURITY DEFINER because inventory roles
--      add donations but may not update donors; it only recomputes, it takes no input.
--   3. Every donor is recomputed once now.
--   4. Deleting a donor no longer deletes their donations, pledges and campaign commitments
--      (ON DELETE CASCADE -> RESTRICT): a donor with history can't be deleted; one without can.
--      Their VIP portal account still goes with them.

create or replace function ops.donor_totals(p_donor uuid, out n integer, out v numeric, out first_d date, out last_d date)
language sql stable security definer
set search_path to 'ops', 'pg_temp' as $$
  select count(*)::integer, coalesce(sum(total_value), 0), min(date), max(date)
  from ops.donations where donor_id = p_donor;
$$;
-- Internal only: it reads every donation of a donor, past RLS.
revoke all on function ops.donor_totals(uuid) from public, anon, authenticated;

create or replace function ops.keep_donor_totals()
returns trigger language plpgsql security definer
set search_path to 'ops', 'pg_temp' as $$
declare
  t record;
begin
  select * into t from ops.donor_totals(new.id);
  new.gift_count := t.n;
  new.lifetime_value := t.v;
  new.first_gift_date := t.first_d;
  new.last_gift_date := t.last_d;
  return new;
end;
$$;
revoke all on function ops.keep_donor_totals() from public, anon, authenticated;

drop trigger if exists keep_donor_totals on ops.donors;
create trigger keep_donor_totals
  before insert or update of gift_count, lifetime_value, first_gift_date, last_gift_date on ops.donors
  for each row execute function ops.keep_donor_totals();

create or replace function ops.donations_touch_donor()
returns trigger language plpgsql security definer
set search_path to 'ops', 'pg_temp' as $$
begin
  -- Naming gift_count in SET fires keep_donor_totals, which recomputes all four.
  if tg_op <> 'DELETE' then
    update ops.donors set gift_count = gift_count where id = new.donor_id;
  end if;
  if tg_op = 'DELETE' or old.donor_id is distinct from new.donor_id then
    update ops.donors set gift_count = gift_count where id = old.donor_id;
  end if;
  return null;
end;
$$;
revoke all on function ops.donations_touch_donor() from public, anon, authenticated;

drop trigger if exists donations_touch_donor on ops.donations;
create trigger donations_touch_donor
  after insert or delete or update of donor_id, total_value, date on ops.donations
  for each row execute function ops.donations_touch_donor();

-- 3. Put every donor right once.
update ops.donors set gift_count = gift_count;

-- 4. History stays with the foundation, not with a deleted donor row.
alter table ops.donations drop constraint donations_donor_id_fkey,
  add constraint donations_donor_id_fkey foreign key (donor_id) references ops.donors (id) on delete restrict;
alter table ops.donor_pledges drop constraint donor_pledges_donor_id_fkey,
  add constraint donor_pledges_donor_id_fkey foreign key (donor_id) references ops.donors (id) on delete restrict;
alter table ops.campaign_commitments drop constraint campaign_commitments_donor_id_fkey,
  add constraint campaign_commitments_donor_id_fkey foreign key (donor_id) references ops.donors (id) on delete restrict;

notify pgrst, 'reload schema';
