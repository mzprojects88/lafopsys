-- 0123: saved transport places, for the destination pin without a paid map (decided 30 Oct 2026).
--
-- Google Maps needs an active billing account; LAF's trips go almost only between LAF House and
-- the hospital. So the places a trip goes to are kept here with their coordinates (pasted from
-- Google Maps or picked on a free OpenStreetMap map), a trip's destination is matched to one by
-- name, and the app shows the pin, a directions link and a by-map estimate of the km. The actual km
-- stays the odometer's (0078). LAF House's own pin is the DTR one (laf_house_latitude/longitude).

alter table shared.app_settings
  add column if not exists transport_places jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'app_settings_transport_places_is_list') then
    alter table shared.app_settings add constraint app_settings_transport_places_is_list
      check (jsonb_typeof(transport_places) = 'array' and jsonb_array_length(transport_places) <= 100);
  end if;
end $$;

comment on column shared.app_settings.transport_places is
  'Places trips go to (0123): [{name, lat, lng}]. A trip''s destination shows its pin when the name matches; admins edit it in Settings.';

notify pgrst, 'reload schema';
