-- 0152 Report graphs (user, 13 Nov 2026: "a graph builder as part of the report profile ... bar graph, pie graph,
-- line graph and other type"; "2-3 sample graphs, always have graphs, hiding is an option").
--
-- A report profile (0150) keeps its own graphs: each a title, a type (scorecard, bar, horizontal bar, stacked bar,
-- line, area, bar + line, pie, donut, gauge, variance, big numbers), the figures it draws by their fixed ids, how they
-- are shown (period vs previous, YTD and goal; over the period; month by month; as a breakdown), where it prints, and
-- whether it is hidden. The app knows the figure ids and the rules (lib/utils/report-graphs.ts); the database checks
-- the shape only. Who may save is unchanged (0150: the Super Admin, the CEO, Finance).
--
-- The built-in profiles get two or three sample graphs each, and the Executive summary's four "table only" sections
-- go back to their own graph (a scorecard), unless someone changed them since.

alter table ops.report_profiles add column if not exists graphs jsonb not null default '[]'::jsonb;
alter table ops.report_profiles drop constraint if exists report_profiles_graphs_check;
alter table ops.report_profiles add constraint report_profiles_graphs_check
  check (jsonb_typeof(graphs) = 'array' and jsonb_array_length(graphs) <= 12 and pg_column_size(graphs) <= 32000);

-- graphs-seed: begin (tests/report-graphs.test.mjs reads these and checks every graph draws)
update ops.report_profiles p set graphs = v.graphs
from (values
  ('executive summary', '[
    {"id":"s1","title":"Change from the period before","type":"variance","measures":["headline.bed_nights","headline.rides","headline.meals","headline.child_visits","headline.care_cart","headline.patients","headline.cash","headline.expenses"],"showBy":"comparisons","place":"top"},
    {"id":"s2","title":"Meals by month","type":"stacked","measures":["meals.meals_breakfast","meals.meals_lunch","meals.meals_dinner"],"showBy":"months","place":"meals","goalLine":true},
    {"id":"s3","title":"Where the gifts came from","type":"donut","measures":["donations.cash","donations.gik_food","donations.gik_nonfood"],"showBy":"breakdown","place":"donations"}
  ]'::jsonb),
  ('impact report', '[
    {"id":"s1","title":"The year in numbers","type":"kpi","measures":["headline.bed_nights","headline.rides","headline.meals","headline.child_visits","headline.care_cart","headline.patients"],"showBy":"comparisons","place":"top"},
    {"id":"s2","title":"People housed by month","type":"line","measures":["housing.housing"],"showBy":"months","place":"housing","goalLine":true},
    {"id":"s3","title":"Care Cart by run time","type":"donut","measures":["care_cart.care_cart_1000","care_cart.care_cart_1200","care_cart.care_cart_1700"],"showBy":"breakdown","place":"care_cart"}
  ]'::jsonb),
  ('financial report', '[
    {"id":"s1","title":"Money in and out","type":"kpi","measures":["donations.cash","donations.gik","expenses.paid","expenses.budget"],"showBy":"comparisons","place":"top"},
    {"id":"s2","title":"Gifts by month","type":"stacked","measures":["donations.cash","donations.gik_food","donations.gik_nonfood"],"showBy":"months","place":"donations"},
    {"id":"s3","title":"Spending by account","type":"pie","measures":["expenses.by_account"],"showBy":"breakdown","place":"expenses"}
  ]'::jsonb),
  ('one child report', '[
    {"id":"s1","title":"The One Child fund at a glance","type":"kpi","measures":["expenses.paid","expenses.vouchers"],"showBy":"comparisons","place":"top"},
    {"id":"s2","title":"Paid by account","type":"hbar","measures":["expenses.by_account"],"showBy":"breakdown","place":"expenses"}
  ]'::jsonb),
  ('operations report', '[
    {"id":"s1","title":"Change from the period before","type":"variance","measures":["occupancy.families","occupancy.beds_pct","housing.housing","transportation.trips","staff.hours","staff.late"],"showBy":"comparisons","place":"top"},
    {"id":"s2","title":"Staff hours by month","type":"area","measures":["staff.hours"],"showBy":"months","place":"staff"},
    {"id":"s3","title":"Goods received","type":"donut","measures":["inventory.food","inventory.nonfood"],"showBy":"breakdown","place":"inventory"}
  ]'::jsonb)
) v(name, graphs)
where lower(btrim(p.name)) = v.name and p.built_in and p.graphs = '[]'::jsonb;
-- graphs-seed: end

update ops.report_profiles set charts = '{}'::jsonb
where lower(btrim(name)) = 'executive summary' and built_in
  and charts = '{"housing":"table","meals":"table","transportation":"table","care_cart":"table"}'::jsonb;
