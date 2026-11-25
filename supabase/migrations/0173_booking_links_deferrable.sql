-- 0173: every link of the booking tables can be deferred, as the rule since 0125 asks of every new link
-- (the hourly copy between development and production defers them all; a link that can't be deferred stops it,
-- and several booking tables point at shared.staff, which that copy writes).
--
-- 0172 now declares them so itself. Development ran 0172 before that correction, so this brings any database
-- that has the older form into line; where 0172 ran in its corrected form this changes nothing.

do $$
declare
  k record;
begin
  for k in
    select c.conrelid::regclass as tbl, c.conname
      from pg_constraint c
     where c.contype = 'f' and c.connamespace = 'booking'::regnamespace and not c.condeferrable
  loop
    execute format('alter table %s alter constraint %I deferrable initially immediate', k.tbl, k.conname);
  end loop;
end $$;
