-- DTR plan phase 4 (user 2026-09-24): a punch within 20 m of LAF House
-- (35 Tulip, Roxas District, Quezon City) is on-site; anywhere else is
-- off-site, and the DTR shows the address the phone was at. Nothing is
-- refused -- a refused punch would lock the person out of the app.
--
-- The pin and the radius are Settings (admins), set by standing at the
-- house and using the phone's position, or by typing the coordinates.
-- Until the pin is set every punch is `unknown`.
--
-- Each punch keeps the verdict and the distance it had WHEN it was made:
-- moving the pin later must not rewrite where people were.

alter table shared.app_settings
  add column laf_house_latitude numeric(9, 6) check (laf_house_latitude between -90 and 90),
  add column laf_house_longitude numeric(9, 6) check (laf_house_longitude between -180 and 180),
  add column laf_house_radius_m integer not null default 20 check (laf_house_radius_m between 10 and 1000),
  add constraint app_settings_laf_house_pin_complete check ((laf_house_latitude is null) = (laf_house_longitude is null));

alter table ops.time_punches
  add column site_status text not null default 'unknown' check (site_status in ('on_site', 'off_site', 'unknown')),
  add column site_distance_m integer check (site_distance_m >= 0);

comment on column ops.time_punches.site_status is
  'Within shared.app_settings.laf_house_radius_m of the LAF House pin when punched (0063); unknown = no position or no pin yet.';

notify pgrst, 'reload schema';
