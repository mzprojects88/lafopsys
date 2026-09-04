-- Reverses 0027: drops every ops.* / shared.* table from the supabase_realtime
-- publication except the two DTR tables 0019 added. The app keeps working
-- without realtime (stores still refetch after their own mutations and on
-- tab focus); cross-user updates just wait for the next mount or focus.

do $$
declare
  t record;
  removed int := 0;
begin
  for t in
    select schemaname, tablename
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname in ('ops', 'shared')
      and not (schemaname = 'ops' and tablename in ('time_entries', 'time_punches'))
    order by schemaname, tablename
  loop
    execute format('alter publication supabase_realtime drop table %I.%I', t.schemaname, t.tablename);
    removed := removed + 1;
  end loop;
  raise notice 'supabase_realtime: removed % table(s) from ops/shared', removed;
end
$$;
