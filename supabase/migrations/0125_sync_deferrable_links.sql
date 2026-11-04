-- 0125 Every link between tables can wait until the end of a transaction.
--
-- The hourly dev <-> production sync (0104, app/api/db-sync) copies tables in any order and relies on
-- `set constraints all deferred`, which only reaches links declared DEFERRABLE. Links added since
-- (0106 house stocks, 0110/0111 bank transactions, 0120 weekly menu, 0124 case files) were not, so
-- from 26 Oct 2026 every run stopped on the first one and rolled back: dev stopped receiving data.
--
-- DEFERRABLE INITIALLY IMMEDIATE changes nothing for the apps: each link is still checked at the end
-- of every statement, as before. Only a transaction that asks (the sync) can check them at commit.
-- New links must be declared `deferrable initially immediate` too (tests/sync-deferrable.test.mjs).

do $$
declare r record;
begin
  for r in
    select n.nspname, c.relname, k.conname
      from pg_constraint k
      join pg_class c on c.oid = k.conrelid
      join pg_namespace n on n.oid = c.relnamespace
     where k.contype = 'f' and not k.condeferrable and n.nspname in ('ops', 'shared', 'hr', 'inventory')
  loop
    execute format('alter table %I.%I alter constraint %I deferrable initially immediate', r.nspname, r.relname, r.conname);
  end loop;
end $$;
