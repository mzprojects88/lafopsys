-- 0105: the sync schema (0104) is readable through the API, so Settings > Database sync can list the
-- runs and the clashes (admins only, by the policies in 0104). Same step as 0003 for the other schemas.
alter role authenticator set pgrst.db_schemas = 'public, ops, inventory, shared, hr, sync';
notify pgrst, 'reload config';
