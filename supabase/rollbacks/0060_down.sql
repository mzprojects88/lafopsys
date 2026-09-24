-- Undo 0060. The photos stay in the B2 bucket under "DTR photos/"; delete
-- them there if the feature is withdrawn for good.
drop table if exists ops.time_punch_photos;
alter table ops.time_punches drop column if exists photo_status;
notify pgrst, 'reload schema';
