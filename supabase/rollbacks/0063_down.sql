-- Undo 0063.
alter table ops.time_punches drop column if exists site_distance_m, drop column if exists site_status;
alter table shared.app_settings
  drop constraint if exists app_settings_laf_house_pin_complete,
  drop column if exists laf_house_radius_m,
  drop column if exists laf_house_longitude,
  drop column if exists laf_house_latitude;
notify pgrst, 'reload schema';
