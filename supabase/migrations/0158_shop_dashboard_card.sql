-- 0158 The shop on the dashboard (user, 17 Nov 2026): one more card for the dashboard profiles (0147).
--
-- "Shop sales": what the shop sold in the chosen period and the orders waiting to be packed. The card is offered to
-- the roles that can open the Shop (0155): the Shop Admin, Finance and the CEO; the Super Admin has
-- every card. The figures themselves come from the shop's own tables under each person's Shop access, so a profile
-- given the card without the Shop sees an empty card, never someone else's figures.

alter table shared.role_dashboard_cards drop constraint if exists role_dashboard_cards_card_check;
alter table shared.role_dashboard_cards add constraint role_dashboard_cards_card_check
  check (card in ('housing', 'rides', 'meals', 'child_visits', 'care_cart', 'patients', 'cash', 'gifts', 'expenses',
                  'in_house', 'since_2024', 'waiting', 'funds', 'budget', 'compliance', 'volunteers', 'stock',
                  'transport_costs', 'caf_nights', 'staff_in', 'goals', 'beds', 'shop'));

insert into shared.role_dashboard_cards (role, card)
select r, 'shop' from unnest(array['shop_admin', 'finance', 'ceo']) r where exists (select 1 from shared.roles where key = r)
on conflict do nothing;

notify pgrst, 'reload schema';
