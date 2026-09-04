-- Publishes every ops.* and shared.* table to Supabase Realtime so the app's
-- live-update layer (lib/data/realtime-provider.tsx) hears about writes from
-- other users, tabs and devices. 0019 published only the two DTR tables.
--
-- Written as a loop rather than `add tables in schema ops, shared` because
-- that form needs a superuser and Supabase's postgres role is not one.
-- Idempotent: tables already in the publication are skipped, so re-running
-- after a migration that creates a table picks it up. New tables can also be
-- added in their own migration with
--   alter publication supabase_realtime add table ops.<new_table>;
--
-- What the client receives:
--   * Default replica identity (primary key) is enough -- the app only uses
--     the event's schema/table to decide which cached collection to refetch,
--     never the row payload, and every table here has a primary key.
--   * INSERT/UPDATE events are filtered by the receiving user's SELECT
--     policies, so own-row tables (ops.time_punches) and admin/finance-only
--     tables (shared.donor_accounts) stay private. DELETE events carry only
--     the primary key and are not RLS-filtered; harmless here because the
--     client reacts by re-running an RLS-gated SELECT, not by reading the event.

do $$
declare
  t record;
  added int := 0;
begin
  for t in
    select schemaname, tablename
    from pg_tables
    where schemaname in ('ops', 'shared')
      and not exists (
        select 1
        from pg_publication_tables p
        where p.pubname = 'supabase_realtime'
          and p.schemaname = pg_tables.schemaname
          and p.tablename = pg_tables.tablename
      )
    order by schemaname, tablename
  loop
    execute format('alter publication supabase_realtime add table %I.%I', t.schemaname, t.tablename);
    added := added + 1;
  end loop;
  raise notice 'supabase_realtime: added % table(s) from ops/shared', added;
end
$$;
