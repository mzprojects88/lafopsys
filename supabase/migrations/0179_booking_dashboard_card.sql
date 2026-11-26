-- 0179: a dashboard card for LAF Activity Center Bookings (requests waiting for an answer, what is coming, visits
-- to record). The card reads under the person's own access to Bookings, so a role without the pages sees zeros.
--
-- The list of cards the database allows grows by one. The card is put on the dashboards of the two roles that
-- process bookings, on production only (the database that runs the scheduled jobs, as 0174): the table is copied
-- between the databases every hour, and a row placed on development first would be refused by a production that
-- does not know the card yet. Anyone else may switch the card on from their own dashboard.

alter table shared.role_dashboard_cards drop constraint if exists role_dashboard_cards_card_check;
alter table shared.role_dashboard_cards add constraint role_dashboard_cards_card_check
  check (card in ('housing', 'rides', 'meals', 'child_visits', 'care_cart', 'patients', 'cash', 'gifts', 'expenses',
                  'in_house', 'since_2024', 'waiting', 'funds', 'budget', 'compliance', 'volunteers', 'stock',
                  'transport_costs', 'caf_nights', 'staff_in', 'goals', 'beds', 'shop', 'bookings'));

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from cron.job where jobname = 'house-sheet-sync') then
    insert into shared.role_dashboard_cards (role, card)
    select r, 'bookings' from unnest(array['social_worker', 'office_admin']) r where exists (select 1 from shared.roles where key = r)
    on conflict do nothing;
  end if;
end $$;

notify pgrst, 'reload schema';
