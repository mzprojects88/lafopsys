-- Reverses 0048: the floor plan's custom labels go.
--
-- DESTRUCTIVE: every label an admin has written on the plan is lost. Export first:
--
--   select id, text, x, y, rotation_deg, font_size from ops.floor_plan_labels;

alter publication supabase_realtime drop table ops.floor_plan_labels;
drop table ops.floor_plan_labels; -- its policies and the set_updated_at trigger go with it

notify pgrst, 'reload schema';
