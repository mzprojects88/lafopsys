-- 0109: roll-out steps 2-7 -- the page levels the remaining modules open with (user, 2026-10-25).
--
-- House Ops, Donors, Finance, Compliances, HR and Executive come off NEXT_PUBLIC_HIDDEN_ROUTES one
-- at a time; the roles 0093 seeded keep their levels (drivers, house staff and social workers run
-- House Ops; finance and the office admin run Donors, Finance and Compliances; everyone reads their
-- own leave and payslips). This adds the readers: the CEO views every opened module, the board
-- views Donors as it views Finance. The chef and nutritionist deliberately stay out of House Ops --
-- a House Ops level opens the residents' data, and the kitchen works from LAF Inventory.
insert into shared.role_page_access (role, page, level)
select 'ceo', p.page, 'view'
  from (values ('house_ops.overview'), ('house_ops.meals'), ('house_ops.care_cart'), ('house_ops.activity_center'), ('house_ops.stocks'),
               ('donors.list'), ('donors.receipts'), ('donors.donee_certs'), ('donors.campaigns'), ('donors.cash'), ('donors.totals'),
               ('finance.overview'), ('finance.monthly_summary'), ('finance.registers'), ('finance.vehicle_costs'),
               ('compliance.tracker'), ('executive.overview')) as p(page)
union all
select 'board', p.page, 'view'
  from (values ('donors.list'), ('donors.receipts'), ('donors.campaigns'), ('donors.totals')) as p(page)
on conflict do nothing;
