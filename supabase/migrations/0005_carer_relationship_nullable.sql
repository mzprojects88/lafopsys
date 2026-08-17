-- Real carer data has 1 record (of 169) with no relationship recorded
-- (Mark Louie Illana, carer of pt-real-146) -- the app's Carer.relationship
-- type says required, but that's not actually true of the real data. Loosen
-- to match reality rather than fabricate a placeholder like "Guardian".
alter table ops.carers alter column relationship drop not null;
