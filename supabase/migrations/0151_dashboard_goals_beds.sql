-- 0151 Dashboard: the goals and the beds (user's notes, 12 Nov 2026: "add project goals, # of beds").
--
-- Two more cards for the dashboard profiles (0147): Goals (each active goal's progress this year, for those who may
-- read goals: the CEO, the Trustees and the Super Admin, 0137) and Beds (the beds on the floor plan, regular and
-- temporary, and tonight's use), for every staff role.

alter table shared.role_dashboard_cards drop constraint if exists role_dashboard_cards_card_check;
alter table shared.role_dashboard_cards add constraint role_dashboard_cards_card_check
  check (card in ('housing', 'rides', 'meals', 'child_visits', 'care_cart', 'patients', 'cash', 'gifts', 'expenses',
                  'in_house', 'since_2024', 'waiting', 'funds', 'budget', 'compliance', 'volunteers', 'stock',
                  'transport_costs', 'caf_nights', 'staff_in', 'goals', 'beds'));

insert into shared.role_dashboard_cards (role, card)
select r, 'goals' from unnest(array['ceo', 'board']) r where exists (select 1 from shared.roles where key = r)
union all
select key, 'beds' from shared.roles where key not in ('admin', 'partner_viewer')
on conflict do nothing;

notify pgrst, 'reload schema';
