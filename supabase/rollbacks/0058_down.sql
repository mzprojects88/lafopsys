-- Undo 0058. Only once every patient has a sex again:
--   select count(*) from ops.patients where sex is null;  -- must be 0
alter table ops.patients alter column sex set not null;
notify pgrst, 'reload schema';
