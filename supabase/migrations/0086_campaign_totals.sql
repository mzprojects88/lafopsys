-- 0086: a campaign's raised amount always follows its gifts (Sprint 6, decided by the user 2026-10-13).
--
-- ops.campaigns.raised_amount was a stored number the browser added to once, when a gift was
-- recorded with a campaign; nothing ever set donations.campaign_id, nothing reversed an edit or
-- a deletion, so every campaign showed 0. Same pattern as the donor totals (0082):
--
--   1. ops.campaign_totals: the sum of FINALIZED PHP gifts linked to the campaign. USD gifts are
--      listed with the campaign but not summed (no exchange-rate rule yet); gifts still pending
--      finance review don't count until they are finalized.
--   2. A BEFORE trigger on ops.campaigns overwrites whatever raised_amount the caller sends;
--      an AFTER trigger on ops.donations touches the campaign(s) a changed gift belongs to.
--   3. Campaigns gain a description, a status (active/closed) and updated_at; a campaign with
--      gifts can't be deleted (close it instead); donations(campaign_id) is indexed.

alter table ops.campaigns
  add column if not exists description text check (description is null or char_length(description) <= 500),
  add column if not exists status text not null default 'active' check (status in ('active', 'closed')),
  add column if not exists updated_at timestamptz not null default now();
drop trigger if exists set_updated_at on ops.campaigns;
create trigger set_updated_at before update on ops.campaigns for each row execute function shared.set_updated_at();

alter table ops.donations drop constraint if exists donations_campaign_id_fkey;
alter table ops.donations add constraint donations_campaign_id_fkey foreign key (campaign_id) references ops.campaigns (id) on delete restrict;
create index if not exists donations_campaign_id on ops.donations (campaign_id) where campaign_id is not null;

create or replace function ops.campaign_totals(p_campaign uuid)
returns numeric language sql stable security definer
set search_path to 'ops', 'pg_temp' as $$
  select coalesce(sum(total_value), 0) from ops.donations
  where campaign_id = p_campaign and status = 'finalized' and currency = 'PHP';
$$;
revoke all on function ops.campaign_totals(uuid) from public, anon, authenticated;

create or replace function ops.keep_campaign_totals()
returns trigger language plpgsql security definer
set search_path to 'ops', 'pg_temp' as $$
begin
  new.raised_amount := ops.campaign_totals(new.id);
  return new;
end;
$$;
revoke all on function ops.keep_campaign_totals() from public, anon, authenticated;

drop trigger if exists keep_campaign_totals on ops.campaigns;
create trigger keep_campaign_totals
  before insert or update of raised_amount on ops.campaigns
  for each row execute function ops.keep_campaign_totals();

create or replace function ops.donations_touch_campaign()
returns trigger language plpgsql security definer
set search_path to 'ops', 'pg_temp' as $$
begin
  if tg_op <> 'DELETE' and new.campaign_id is not null then
    update ops.campaigns set raised_amount = raised_amount where id = new.campaign_id;
  end if;
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.campaign_id is distinct from new.campaign_id) then
    if old.campaign_id is not null then
      update ops.campaigns set raised_amount = raised_amount where id = old.campaign_id;
    end if;
  end if;
  return null;
end;
$$;
revoke all on function ops.donations_touch_campaign() from public, anon, authenticated;

drop trigger if exists donations_touch_campaign on ops.donations;
create trigger donations_touch_campaign
  after insert or delete or update of campaign_id, total_value, status, currency on ops.donations
  for each row execute function ops.donations_touch_campaign();

-- Once, for what is there (every campaign today reads 0).
update ops.campaigns set raised_amount = raised_amount;

notify pgrst, 'reload schema';
