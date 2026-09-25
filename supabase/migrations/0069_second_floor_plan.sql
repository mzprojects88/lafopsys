-- The floor plan moves to the new 2nd-floor drawing (user, 2026-09-25):
-- public/floor-plan/second-floor-plan.png, 2000 x 1414 (was a 1087 x 1447
-- portrait drawing). Positions are stored as fractions of the image, so
-- every bed, room outline and label is re-set for the new drawing:
-- - rooms traced on it (A/B/C on the lettered copy the user matched; the
--   bathrooms beside B and C are left out of the outlines);
-- - names follow the labels staff see: the room with B1-B4 is Room 1, B5-B9
--   Room 2, B10-B13 Room 3 (the stored names had 1 and 3 swapped);
-- - each bed set inside its own room at this drawing's scale (a bed ~0.9 x
--   1.7 m; a door here is ~90 px), upright, ready to be nudged in edit mode.
-- Codes, occupants, stays, locks and history are untouched.
-- Rollback: supabase/rollbacks/0069_down.sql restores today's values.

update ops.rooms set name = '__renaming_' || id where id in ('room-1', 'room-3');
update ops.rooms set name = 'Room 1', sort_order = 1, bounds = '[[0.1036, 0.2778], [0.2786, 0.2778], [0.2786, 0.8687], [0.1036, 0.8687]]'::jsonb where id = 'room-3';
update ops.rooms set name = 'Room 2', sort_order = 2, bounds = '[[0.2893, 0.0485], [0.5057, 0.0485], [0.5057, 0.3081], [0.5914, 0.3081], [0.5914, 0.4495], [0.2893, 0.4495]]'::jsonb where id = 'room-2';
update ops.rooms set name = 'Room 3', sort_order = 3, bounds = '[[0.6057, 0.0485], [0.7071, 0.0485], [0.7071, 0.303], [0.8214, 0.303], [0.8214, 0.6667], [0.6057, 0.6667]]'::jsonb where id = 'room-1';
update ops.units set x = 0.14714, y = 0.37179, w = 0.065, h = 0.17, rotation_deg = 0 where code = 'B1';
update ops.units set x = 0.23429, y = 0.37179, w = 0.065, h = 0.17, rotation_deg = 0 where code = 'B2';
update ops.units set x = 0.14714, y = 0.54556, w = 0.065, h = 0.17, rotation_deg = 0 where code = 'B3';
update ops.units set x = 0.23429, y = 0.54556, w = 0.065, h = 0.17, rotation_deg = 0 where code = 'B4';
update ops.units set x = 0.32786, y = 0.14144, w = 0.065, h = 0.17, rotation_deg = 0 where code = 'B5';
update ops.units set x = 0.39786, y = 0.14144, w = 0.065, h = 0.17, rotation_deg = 0 where code = 'B6';
update ops.units set x = 0.46786, y = 0.14144, w = 0.065, h = 0.17, rotation_deg = 0 where code = 'B7';
update ops.units set x = 0.325, y = 0.31825, w = 0.065, h = 0.17, rotation_deg = 0 where code = 'B8';
update ops.units set x = 0.46786, y = 0.31825, w = 0.065, h = 0.17, rotation_deg = 0 where code = 'B9';
update ops.units set x = 0.70357, y = 0.40412, w = 0.065, h = 0.17, rotation_deg = 0 where code = 'B10';
update ops.units set x = 0.77857, y = 0.40412, w = 0.065, h = 0.17, rotation_deg = 0 where code = 'B11';
update ops.units set x = 0.70357, y = 0.57587, w = 0.065, h = 0.17, rotation_deg = 0 where code = 'B12';
update ops.units set x = 0.77857, y = 0.57587, w = 0.065, h = 0.17, rotation_deg = 0 where code = 'B13';
update ops.floor_plan_labels set x = 0.19143, y = 0.76783, rotation_deg = 0 where text = 'ROOM 1';
update ops.floor_plan_labels set x = 0.54643, y = 0.41423, rotation_deg = 0 where text = 'ROOM 2';
update ops.floor_plan_labels set x = 0.65571, y = 0.1768, rotation_deg = 0 where text = 'ROOM 3';

-- Every bed and label is on the new drawing (13 beds, 3 labels expected).
do $$ begin
  if (select count(*) from ops.units where active and x is not null and w = 0.065) <> 13 then
    raise exception 'expected 13 beds re-set';
  end if;
end $$;
