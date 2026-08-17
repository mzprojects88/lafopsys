-- Creating a schema does not make it reachable through the Supabase REST API --
-- PostgREST only serves schemas listed in the `authenticator` role's
-- pgrst.db_schemas setting (defaults to just `public, graphql_public`).
-- Confirmed by direct test: querying shared.staff via /rest/v1/ returned
-- PGRST106 "Invalid schema: shared" before this migration.

alter role authenticator set pgrst.db_schemas = 'public, ops, inventory, shared';

-- `authenticated` gets table-level access, gated by the RLS policies already
-- defined per-table (migrations 0001/0002) -- this grant alone does not bypass
-- RLS. `service_role` bypasses RLS by design (used for admin scripts, e.g.
-- scripts/seed-super-admin.mjs). No grants to `anon` -- there's no anonymous
-- access need for ops.*/shared.* data; the public site reads metric_snapshots
-- through a dedicated API route, not raw PostgREST, per the Operations Plan.

grant usage on schema shared, ops to authenticated, service_role;

grant select, insert, update, delete on all tables in schema shared to authenticated, service_role;
grant select, insert, update, delete on all tables in schema ops to authenticated, service_role;
grant usage on all sequences in schema shared to authenticated, service_role;
grant usage on all sequences in schema ops to authenticated, service_role;
grant execute on all functions in schema shared to authenticated, service_role;

alter default privileges in schema shared grant select, insert, update, delete on tables to authenticated, service_role;
alter default privileges in schema ops grant select, insert, update, delete on tables to authenticated, service_role;
alter default privileges in schema shared grant usage on sequences to authenticated, service_role;
alter default privileges in schema ops grant usage on sequences to authenticated, service_role;

-- Tell PostgREST to pick up the new pgrst.db_schemas setting without a restart.
notify pgrst, 'reload config';
